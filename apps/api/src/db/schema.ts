/**
 * Data model.
 *
 *   suites ─< tasks                      what to test (loaded from suites/*.yaml)
 *   agent_configs                        how to configure Hermes (model, skills, memory, tools)
 *   experiments ─< experiment_arms       suite × {A, B} × N trials; each arm FREEZES its config
 *   experiments ─< runs                  one row per (arm, task, trial); doubles as the job queue
 *   runs ─< run_sessions                 one per Hermes session (memory tasks have 2+)
 *   runs ─< grader_results               one per grader, with a human-readable reason
 *
 * Statistics are computed on read from runs; nothing derived is stored.
 */
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ── Enums ────────────────────────────────────────────────────────────────────

export const taskCategory = pgEnum('task_category', ['skill', 'control', 'memory']);

/** off: no memory · on: agent writes memory, carried across sessions · seeded: starts with memory_seed */
export const memoryMode = pgEnum('memory_mode', ['off', 'on', 'seeded']);

/** installed: copied into HERMES_HOME/skills (agent must discover it) · pinned: injected via skills.auto_load */
export const skillMode = pgEnum('skill_mode', ['installed', 'pinned']);

export const experimentStatus = pgEnum('experiment_status', [
  'pending', 'running', 'completed', 'cancelled', 'failed',
]);

/**
 * Lifecycle + outcome in one column, because the queue and the UI both key off it.
 * Only passed/failed count towards statistics; agent_error and timeout are agent
 * failures (scored as failed by analysis); infra_error is retried, then EXCLUDED,
 * never scored as 0.
 */
export const runStatus = pgEnum('run_status', [
  'queued', 'running', 'passed', 'failed', 'agent_error', 'timeout', 'infra_error',
]);

// ── What to test ─────────────────────────────────────────────────────────────

export const suites = pgTable('suites', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  version: integer('version').notNull().default(1),
  createdAt: createdAt(),
});

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    suiteId: uuid('suite_id').notNull().references(() => suites.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    category: taskCategory('category').notNull(),
    /** One entry per Hermes session, run in order on the same HERMES_HOME. */
    sessions: jsonb('sessions').$type<{ prompt: string }[]>().notNull(),
    /** Files planted in the task workspace before session 1: path → content. */
    fixtures: jsonb('fixtures').$type<Record<string, string>>().notNull().default({}),
    /** Grader specs; exact shape is defined with the graders (Phase 3). */
    graders: jsonb('graders').$type<unknown[]>().notNull(),
    timeoutS: integer('timeout_s').notNull().default(300),
    maxIterations: integer('max_iterations').notNull().default(30),
    /** False once a task is removed from its suite file. Kept (not deleted) because runs reference it. */
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('tasks_suite_slug_uq').on(t.suiteId, t.slug)],
);

// ── How to configure Hermes ──────────────────────────────────────────────────

export const agentConfigs = pgTable('agent_configs', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  provider: text('provider').notNull().default('anthropic'),
  model: text('model').notNull(),
  skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
  skillMode: skillMode('skill_mode').notNull().default('installed'),
  memoryMode: memoryMode('memory_mode').notNull().default('off'),
  memorySeed: text('memory_seed'),
  toolsets: text('toolsets').array().notNull(),
  maxIterations: integer('max_iterations').notNull().default(30),
  runBudgetS: integer('run_budget_s').notNull().default(300),
  createdAt: createdAt(),
});

// ── Experiments ──────────────────────────────────────────────────────────────

export const experiments = pgTable('experiments', {
  id: id(),
  name: text('name').notNull(),
  suiteId: uuid('suite_id').notNull().references(() => suites.id),
  trialsPerTask: integer('trials_per_task').notNull(),
  status: experimentStatus('status').notNull().default('pending'),
  /** Exact Hermes build that produced these results (runner/HERMES_COMMIT). */
  hermesCommit: text('hermes_commit').notNull(),
  judgeModel: text('judge_model'),
  concurrency: integer('concurrency').notNull().default(4),
  /** Seed for the bootstrap CI, so re-analysing the same runs gives the same interval. */
  seed: integer('seed').notNull(),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const experimentArms = pgTable(
  'experiment_arms',
  {
    id: id(),
    experimentId: uuid('experiment_id').notNull().references(() => experiments.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    configId: uuid('config_id').references(() => agentConfigs.id, { onDelete: 'set null' }),
    /** Frozen copy of the config at launch: later edits to agent_configs can't rewrite history. */
    configSnapshot: jsonb('config_snapshot').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    unique('experiment_arms_label_uq').on(t.experimentId, t.label),
    check('experiment_arms_label_ck', sql`${t.label} in ('A', 'B')`),
  ],
);

// ── Runs (also the job queue) ────────────────────────────────────────────────

export const runs = pgTable(
  'runs',
  {
    id: id(),
    experimentId: uuid('experiment_id').notNull().references(() => experiments.id, { onDelete: 'cascade' }),
    armId: uuid('arm_id').notNull().references(() => experimentArms.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull().references(() => tasks.id),
    trialIndex: integer('trial_index').notNull(),
    status: runStatus('status').notNull().default('queued'),
    /** Incremented on each claim; infra_error runs are retried up to a limit. */
    attempt: integer('attempt').notNull().default(0),
    /** Not claimable before this time: retries back off (15s, 60s, 4min) instead of hammering a rate-limited provider. */
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    passed: boolean('passed'),
    score: doublePrecision('score'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** Computed by us from token counts and our price table, not Hermes's estimate. */
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    turns: integer('turns'),
    toolCalls: integer('tool_calls'),
    errorKind: text('error_kind'),
    errorMessage: text('error_message'),
    /** Frozen copy of the task at expansion time, for the same reason as config_snapshot. */
    taskSnapshot: jsonb('task_snapshot').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Expanding an experiment twice can't duplicate trials and silently inflate N.
    unique('runs_arm_task_trial_uq').on(t.armId, t.taskId, t.trialIndex),
    // The worker's "claim next due queued run" query (FOR UPDATE SKIP LOCKED).
    index('runs_queue_idx').on(t.status, t.availableAt, t.createdAt),
    index('runs_experiment_idx').on(t.experimentId),
  ],
);

export const runSessions = pgTable(
  'run_sessions',
  {
    id: id(),
    runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    prompt: text('prompt').notNull(),
    finalResponse: text('final_response'),
    /** Full OpenAI-style transcript from Hermes: messages, tool calls, tool results. */
    messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
    /** Tools Hermes actually exposed this session ("was the skill even loaded?"). */
    availableTools: text('available_tools').array().notNull().default(sql`'{}'::text[]`),
    /** Hermes's own outcome flags: failed, partial, failure_reason, failure_retryable, turn_exit_reason. */
    outcome: jsonb('outcome').$type<Record<string, unknown>>().notNull().default({}),
    /** MEMORY.md / USER.md contents after this session, for the trace viewer. */
    memorySnapshot: jsonb('memory_snapshot').$type<Record<string, string>>(),
    usage: jsonb('usage').$type<Record<string, number>>().notNull().default({}),
    durationMs: integer('duration_ms'),
  },
  (t) => [unique('run_sessions_run_idx_uq').on(t.runId, t.idx)],
);

export const graderResults = pgTable(
  'grader_results',
  {
    id: id(),
    runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    graderIdx: integer('grader_idx').notNull(),
    type: text('type').notNull(),
    /** A run passes only if every required grader passes. */
    required: boolean('required').notNull().default(true),
    passed: boolean('passed').notNull(),
    score: doublePrecision('score').notNull(),
    /** Shown in the UI: why this grader passed or failed. */
    reason: text('reason').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    /** Set for llm_judge: changing the judge prompt changes scores, so we record which one. */
    judgePromptVersion: text('judge_prompt_version'),
  },
  (t) => [unique('grader_results_run_idx_uq').on(t.runId, t.graderIdx)],
);
