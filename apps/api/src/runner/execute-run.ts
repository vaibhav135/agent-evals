/**
 * Runs one claimed run end to end. Each step is a call into an already-tested
 * function; what lives here is the order, the persistence and the error
 * handling around them.
 *
 *   snapshots → planRun → writePlan → spawnDriver → normalizeResult
 *   → classifyRun → graders → decideOutcome → computeCost → DB → cleanup
 */
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { AgentConfigSnapshot, TaskSnapshot, type GraderResult } from '@agent-evals/shared';
import type { Db } from '../db/db.module';
import * as schema from '../db/schema';
import { gradeDeterministic, scoreRun, type DeterministicGraderSpec } from '../grading/graders';
import { computeCost } from '../pricing/cost';
import { classifyRun, type RunClassification } from './classify';
import { decideOutcome, type Decision } from './decide-outcome';
import { driverEnv, type HermesEnv } from './hermes-env';
import { planRun } from './plan-run';
import { requeue, type ClaimedRun } from './queue';
import { spawnDriver } from './spawn-driver';
import { normalizeResult, toSessionViews, type NormalizedRun } from './trace';
import { makeWorkspaceReader } from './workspace-reader';
import { writePlan } from './write-plan';

export interface ExecuteDeps {
  db: Db;
  hermes: HermesEnv;
  anthropicApiKey: string;
  runsDir: string;
  driverPath: string;
  skillsDir: string;
  knownSkills: ReadonlySet<string>;
  keepRunDirs: boolean;
  onSpawn?: (child: ChildProcess) => void;
  log?: (msg: string) => void;
}

/** Grace on top of the agent's own budget before the runner kills the process. */
const KILL_GRACE_MS = 60_000;

export async function executeRun(deps: ExecuteDeps, claimed: ClaimedRun): Promise<Decision> {
  const log = deps.log ?? (() => {});
  const runDir = await mkdtemp(join(deps.runsDir, `${claimed.id}-a${claimed.attempt}-`));
  try {
    // 1. Snapshots. If they don't parse, the experiment itself is broken:
    //    fatal, so it stops instead of failing every run the same way.
    const [arm] = await deps.db.select().from(schema.experimentArms).where(eq(schema.experimentArms.id, claimed.armId));
    const config = AgentConfigSnapshot.safeParse(arm?.configSnapshot);
    const task = TaskSnapshot.safeParse(claimed.taskSnapshot);
    if (!config.success || !task.success) {
      const why = !config.success ? `config snapshot: ${config.error.message}` : `task snapshot: ${task.success ? '' : task.error.message}`;
      return persist(deps, claimed, fatalConfig(`invalid ${why}`), null, null, null);
    }

    // 2. Plan + materialise. planRun throws on config errors (unknown skill, bad fixture path).
    let plan;
    try {
      plan = planRun(config.data, task.data, { runDir, skillsSourceDir: deps.skillsDir }, deps.knownSkills);
    } catch (e) {
      return persist(deps, claimed, fatalConfig((e as Error).message), null, null, null);
    }
    await writePlan(plan);

    // 3. Run Hermes with a hard wall-clock limit.
    const budgetMs = plan.spec.runBudgetSeconds * 1000 * task.data.sessions.length;
    const exit = await spawnDriver({
      python: deps.hermes.python,
      driverPath: deps.driverPath,
      specPath: plan.specPath,
      cwd: plan.workspaceDir,
      env: driverEnv(deps.hermes, { hermesHome: plan.homeDir, workspace: plan.workspaceDir, anthropicApiKey: deps.anthropicApiKey }),
      timeoutMs: budgetMs + KILL_GRACE_MS,
      onSpawn: deps.onSpawn,
    });

    // 4. Read + normalise the result. Anything unreadable is the driver's fault (infra).
    let run: NormalizedRun | null = null;
    let readError: string | undefined;
    try {
      run = normalizeResult(JSON.parse(await readFile(plan.outputPath, 'utf8')));
    } catch (e) {
      readError = `no readable result (${(e as Error).message}); driver output: ${exit.logTail.slice(-500)}`;
    }

    // 5. Whose fault, if anything went wrong.
    const classification = classifyRun({ exitCode: exit.exitCode, timedOut: exit.timedOut, run, readError });

    // 6. Grade whenever there is something to grade (also for agent errors, as evidence).
    let graderResults: GraderResult[] | null = null;
    let grading: { passed: boolean; score: number } | null = null;
    if (run && classification.kind !== 'infra_error') {
      const ctx = { sessions: toSessionViews(run), readFile: makeWorkspaceReader(plan.workspaceDir) };
      graderResults = task.data.graders.map((spec) =>
        spec.type === 'llm_judge'
          ? notYetSupported(spec) // judge lands in its own phase; never silently passes
          : gradeDeterministic(spec as DeterministicGraderSpec, ctx),
      );
      grading = scoreRun(graderResults);
    }

    // 7. Decide, then store.
    const decision = decideOutcome({ classification, grading, attempt: claimed.attempt });
    log(`run ${claimed.id} attempt ${claimed.attempt}: ${decision.action === 'retry' ? `retry in ${decision.delayMs}ms (${decision.errorKind})` : decision.status}`);
    return persist(deps, claimed, decision, run, graderResults, config.data.model);
  } finally {
    if (!deps.keepRunDirs) await rm(runDir, { recursive: true, force: true });
  }
}

/** Store one attempt's outcome atomically; on fatal, stop the experiment. */
async function persist(
  deps: ExecuteDeps,
  claimed: ClaimedRun,
  decision: Decision,
  run: NormalizedRun | null,
  graderResults: GraderResult[] | null,
  model: string | null,
): Promise<Decision> {
  if (decision.action === 'retry') {
    await deps.db
      .update(schema.runs)
      .set({ errorKind: decision.errorKind, errorMessage: decision.errorMessage })
      .where(eq(schema.runs.id, claimed.id));
    await requeue(deps.db, claimed.id, decision.delayMs);
    return decision;
  }

  const totals = run?.totals;
  const cost = totals && model ? computeCost(model, totals) : null;

  await deps.db.transaction(async (tx) => {
    // A retry replaces the previous attempt's evidence, so what's stored always matches the final status.
    await tx.delete(schema.runSessions).where(eq(schema.runSessions.runId, claimed.id));
    await tx.delete(schema.graderResults).where(eq(schema.graderResults.runId, claimed.id));

    await tx
      .update(schema.runs)
      .set({
        status: decision.status,
        passed: decision.passed,
        score: decision.score,
        inputTokens: totals?.inputTokens ?? 0,
        outputTokens: totals?.outputTokens ?? 0,
        cacheReadTokens: totals?.cacheReadTokens ?? 0,
        cacheWriteTokens: totals?.cacheWriteTokens ?? 0,
        costUsd: cost?.usd ?? null,
        durationMs: totals?.durationMs ?? null,
        turns: totals?.apiCalls ?? null,
        toolCalls: totals?.toolCalls ?? null,
        errorKind: decision.errorKind,
        errorMessage: decision.errorMessage,
        finishedAt: new Date(),
      })
      .where(eq(schema.runs.id, claimed.id));

    if (run?.sessions.length) {
      await tx.insert(schema.runSessions).values(
        run.sessions.map((s) => ({
          runId: claimed.id,
          idx: s.idx,
          prompt: s.prompt,
          finalResponse: s.finalResponse,
          messages: s.messages,
          availableTools: s.availableTools,
          outcome: { ...s.outcome, exception: s.exception },
          memorySnapshot: s.memorySnapshot,
          usage: s.usage,
          durationMs: s.durationMs,
        })),
      );
    }
    if (graderResults?.length) {
      await tx.insert(schema.graderResults).values(
        graderResults.map((g, i) => ({
          runId: claimed.id,
          graderIdx: i,
          type: g.type,
          required: g.required,
          passed: g.passed,
          score: g.score,
          reason: g.reason,
          details: g.details,
        })),
      );
    }

    if (decision.fatal) {
      // Every other run would fail the same way: stop claiming this experiment's runs.
      await tx
        .update(schema.experiments)
        .set({ status: 'failed', finishedAt: new Date() })
        .where(eq(schema.experiments.id, claimed.experimentId));
    }
  });

  await markCompleteIfDone(deps.db, claimed.experimentId);
  return decision;
}

/** An experiment is done when none of its runs is queued or running. */
export async function markCompleteIfDone(db: Db, experimentId: string): Promise<void> {
  const pending = await db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.experimentId, experimentId), inArray(schema.runs.status, ['queued', 'running'])))
    .limit(1);
  if (pending.length === 0) {
    await db
      .update(schema.experiments)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(and(eq(schema.experiments.id, experimentId), eq(schema.experiments.status, 'running')));
  }
}

function fatalConfig(message: string): Decision {
  const classification: RunClassification = { kind: 'infra_error', errorKind: 'config_error', message, retryable: false, fatal: true };
  return decideOutcome({ classification, grading: null, attempt: 1 });
}

function notYetSupported(spec: { type: string; required: boolean; weight: number }): GraderResult {
  return {
    type: spec.type,
    required: spec.required,
    weight: spec.weight,
    passed: false,
    score: 0,
    reason: 'llm_judge is not implemented yet; this grader cannot pass',
    details: {},
  };
}
