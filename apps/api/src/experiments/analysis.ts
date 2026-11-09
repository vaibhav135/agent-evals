/**
 * Builds an experiment's analysis from its stored runs. Pure, because the
 * status → evidence mapping here decides what the verdict is computed from.
 *
 *   passed                         → pass
 *   failed / agent_error / timeout → fail   (the agent's doing: evidence)
 *   infra_error                    → excluded, counted
 *   queued / running               → not finished yet, counted
 */
import type { ArmStats, ExperimentAnalysis, RunStatus } from '@agent-evals/shared';
import { analyzePaired, type TrialOutcome } from '../analysis/stats';

/** Statuses that are evidence about the agent, and whether each counts as a pass. */
const EVIDENCE: Partial<Record<RunStatus, boolean>> = {
  passed: true,
  failed: false,
  agent_error: false,
  timeout: false,
};
const PENDING: RunStatus[] = ['queued', 'running'];

export interface AnalysisRun {
  armId: string;
  taskId: string;
  status: RunStatus;
  costUsd: number | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AnalysisInput {
  experimentId: string;
  seed: number;
  arms: { id: string; label: 'A' | 'B'; configSlug: string }[];
  tasks: { id: string; slug: string; name: string; category: string }[];
  runs: AnalysisRun[];
  /** Bootstrap resamples (lower in tests). */
  resamples?: number;
}

export function buildAnalysis(input: AnalysisInput): ExperimentAnalysis {
  const labelOf = new Map(input.arms.map((a) => [a.id, a.label]));
  const taskOf = new Map(input.tasks.map((t) => [t.id, t]));

  const outcomes: TrialOutcome[] = [];
  let infraError = 0;
  let pending = 0;
  for (const r of input.runs) {
    const label = labelOf.get(r.armId);
    if (!label) continue;
    const pass = EVIDENCE[r.status];
    if (pass !== undefined) outcomes.push({ taskId: r.taskId, arm: label, passed: pass });
    else if (r.status === 'infra_error') infraError++;
    else if (PENDING.includes(r.status)) pending++;
  }

  const paired = analyzePaired(outcomes, { seed: input.seed, resamples: input.resamples });

  const armStats = (arm: AnalysisInput['arms'][number]): ArmStats => {
    const runs = input.runs.filter((r) => r.armId === arm.id);
    const finished = runs.filter((r) => !PENDING.includes(r.status));
    // Unknown cost (null) is left out rather than counted as $0; infra errors
    // still cost money, so they count towards spend.
    const costs = finished.map((r) => r.costUsd).filter((c): c is number => c !== null);
    // Latency and tokens describe the agent, so only evidence runs count.
    const evidence = runs.filter((r) => EVIDENCE[r.status] !== undefined);
    const durations = evidence.map((r) => r.durationMs).filter((d): d is number => d !== null);
    const tokens = evidence.map((r) => r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens);
    const stats = paired.arms[arm.label];
    return {
      label: arm.label,
      configSlug: arm.configSlug,
      passRate: stats.passRate,
      tasks: stats.tasks,
      trials: stats.trials,
      costUsd: costs.reduce((s, c) => s + c, 0),
      meanCostPerRunUsd: mean(costs),
      meanDurationMs: mean(durations),
      meanTokens: mean(tokens),
    };
  };

  return {
    experimentId: input.experimentId,
    verdict: paired.verdict,
    delta: paired.delta,
    ci: paired.ci,
    arms: [...input.arms].sort((a, b) => a.label.localeCompare(b.label)).map(armStats),
    pairedTasks: paired.pairedTasks,
    unpairedTaskSlugs: paired.unpairedTaskIds.map((id) => taskOf.get(id)?.slug ?? id),
    perTask: paired.perTask.map((t) => {
      const meta = taskOf.get(t.taskId);
      return { ...t, slug: meta?.slug ?? t.taskId, name: meta?.name ?? t.taskId, category: meta?.category ?? 'unknown' };
    }),
    excluded: { infraError, pending },
    resamples: paired.resamples,
    seed: paired.seed,
  };
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
