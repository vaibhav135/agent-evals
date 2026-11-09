/**
 * Builds an experiment's analysis from its stored runs. Pure, because the
 * status → evidence mapping here decides what the verdict is computed from.
 *
 *   passed                         → pass
 *   failed / agent_error / timeout → fail   (the agent's doing: evidence)
 *   infra_error                    → excluded, counted
 *   queued / running               → not finished yet, counted
 */
import type { ExperimentAnalysis, RunStatus } from '@agent-evals/shared';

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

export function buildAnalysis(_input: AnalysisInput): ExperimentAnalysis {
  throw new Error('not implemented');
}
