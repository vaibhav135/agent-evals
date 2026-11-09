/**
 * Paired comparison of two agent configurations (arm A = baseline, arm B = candidate).
 *
 * Unit of analysis is the TASK, not the run: trials of one task are correlated
 * (same prompt, same difficulty), so treating 5 trials × 20 tasks as 100
 * independent samples would make the confidence interval far too narrow.
 * Following Miller, "Adding Error Bars to Evals" (arXiv 2411.00640): compare
 * per-task pass rates pairwise and resample tasks.
 */

export type Arm = 'A' | 'B';

/** One graded run. infra_error runs must be filtered out BEFORE this point. */
export interface TrialOutcome {
  taskId: string;
  arm: Arm;
  passed: boolean;
}

export interface PairedAnalysisOptions {
  /** Bootstrap resamples. Default 10,000. */
  resamples?: number;
  /** PRNG seed: same data + same seed => same CI. Default 1. */
  seed?: number;
  /** CI level. Default 0.95. */
  confidence?: number;
  /** Below this many paired tasks we refuse to call a winner. Default 5. */
  minPairedTasks?: number;
}

export type Verdict =
  /** B better than A: the whole CI is above 0. */
  | 'better'
  /** B worse than A: the whole CI is below 0. */
  | 'worse'
  /** CI includes 0: no detectable difference at this sample size. */
  | 'inconclusive'
  /** Too few paired tasks to say anything. */
  | 'insufficient_data';

export interface ArmTaskStats {
  passes: number;
  trials: number;
  rate: number;
}

export interface TaskComparison {
  taskId: string;
  a: ArmTaskStats;
  b: ArmTaskStats;
  /** b.rate - a.rate */
  delta: number;
}

export interface PairedAnalysis {
  arms: Record<Arm, { passRate: number | null; tasks: number; trials: number }>;
  /** Mean of per-task deltas over paired tasks; null when nothing is paired. */
  delta: number | null;
  ci: { low: number; high: number; level: number } | null;
  verdict: Verdict;
  pairedTasks: number;
  /** Tasks with trials in only one arm: excluded from every number above. */
  unpairedTaskIds: string[];
  /** Paired tasks, largest |delta| first ("what changed most"). */
  perTask: TaskComparison[];
  resamples: number;
  seed: number;
}

export function analyzePaired(_outcomes: TrialOutcome[], _options: PairedAnalysisOptions = {}): PairedAnalysis {
  throw new Error('not implemented');
}
