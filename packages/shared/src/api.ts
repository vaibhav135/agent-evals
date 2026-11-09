/**
 * HTTP API contract. Request bodies are zod schemas (validated by the API);
 * responses are types (the web app is typed against them).
 */
import { z } from 'zod';
import type { AgentConfigSnapshot, TaskSnapshot } from './snapshots.js';

// ── Requests ─────────────────────────────────────────────────────────────────

export const CreateExperimentRequest = z.strictObject({
  name: z.string().min(1).max(200),
  /** Suite slug. */
  suite: z.string().min(1),
  /** Config slugs: A is the baseline, B the candidate. */
  configA: z.string().min(1),
  configB: z.string().min(1),
  trialsPerTask: z.number().int().min(1).max(20),
  /** Bootstrap seed; random when omitted (and stored, so analysis is reproducible). */
  seed: z.number().int().min(1).max(2 ** 31 - 1).optional(),
});
export type CreateExperimentRequest = z.infer<typeof CreateExperimentRequest>;

// ── Responses ────────────────────────────────────────────────────────────────

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'agent_error' | 'timeout' | 'infra_error';
export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
export type Verdict = 'better' | 'worse' | 'inconclusive' | 'insufficient_data';

export interface SuiteSummary {
  slug: string;
  name: string;
  description: string;
  version: number;
  taskCount: number;
}

export interface SuiteDetail extends SuiteSummary {
  tasks: (TaskSnapshot & { id: string })[];
}

export type ConfigSummary = AgentConfigSnapshot & { id: string; description: string };

export interface ExperimentSummary {
  id: string;
  name: string;
  status: ExperimentStatus;
  suite: { slug: string; name: string };
  arms: { label: 'A' | 'B'; config: AgentConfigSnapshot }[];
  trialsPerTask: number;
  hermesCommit: string;
  seed: number;
  /** Run counts by status. */
  progress: Record<RunStatus, number> & { total: number };
  costUsd: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ArmStats {
  label: 'A' | 'B';
  configSlug: string;
  passRate: number | null;
  tasks: number;
  trials: number;
  costUsd: number;
  meanCostPerRunUsd: number | null;
  meanDurationMs: number | null;
  meanTokens: number | null;
}

export interface TaskComparisonRow {
  taskId: string;
  slug: string;
  name: string;
  category: string;
  a: { passes: number; trials: number; rate: number };
  b: { passes: number; trials: number; rate: number };
  delta: number;
}

export interface ExperimentAnalysis {
  experimentId: string;
  verdict: Verdict;
  /** B minus A pass rate, mean over paired tasks. */
  delta: number | null;
  ci: { low: number; high: number; level: number } | null;
  arms: ArmStats[];
  pairedTasks: number;
  unpairedTaskSlugs: string[];
  perTask: TaskComparisonRow[];
  /** Runs left out of the statistics, and why. */
  excluded: { infraError: number; pending: number };
  resamples: number;
  seed: number;
}

export interface RunSummary {
  id: string;
  arm: 'A' | 'B';
  taskSlug: string;
  trialIndex: number;
  status: RunStatus;
  passed: boolean | null;
  score: number | null;
  attempt: number;
  costUsd: number | null;
  durationMs: number | null;
  errorKind: string | null;
}

export interface RunDetail extends RunSummary {
  experimentId: string;
  config: AgentConfigSnapshot;
  task: TaskSnapshot;
  errorMessage: string | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  turns: number | null;
  toolCalls: number | null;
  sessions: {
    idx: number;
    prompt: string;
    finalResponse: string | null;
    messages: unknown[];
    availableTools: string[];
    outcome: Record<string, unknown>;
    memorySnapshot: Record<string, string> | null;
    durationMs: number | null;
  }[];
  graders: {
    idx: number;
    type: string;
    required: boolean;
    passed: boolean;
    score: number;
    reason: string;
    details: Record<string, unknown>;
  }[];
}
