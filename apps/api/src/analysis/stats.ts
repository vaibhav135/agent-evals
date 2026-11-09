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

export function analyzePaired(outcomes: TrialOutcome[], options: PairedAnalysisOptions = {}): PairedAnalysis {
  const resamples = options.resamples ?? 10_000;
  const seed = options.seed ?? 1;
  const level = options.confidence ?? 0.95;
  const minPaired = options.minPairedTasks ?? 5;

  // 1. Tally passes/trials per task per arm.
  const tally = new Map<string, Record<Arm, { passes: number; trials: number }>>();
  for (const o of outcomes) {
    let t = tally.get(o.taskId);
    if (!t) tally.set(o.taskId, (t = { A: { passes: 0, trials: 0 }, B: { passes: 0, trials: 0 } }));
    t[o.arm].trials += 1;
    if (o.passed) t[o.arm].passes += 1;
  }

  // 2. Pair: only tasks with trials in BOTH arms are comparable. Sorted by id
  //    so the result never depends on input order (the bootstrap indexes into it).
  const taskIds = [...tally.keys()].sort();
  const isPaired = (id: string) => tally.get(id)!.A.trials > 0 && tally.get(id)!.B.trials > 0;
  const unpairedTaskIds = taskIds.filter((id) => !isPaired(id));
  const paired: TaskComparison[] = taskIds.filter(isPaired).map((taskId) => {
    const { A, B } = tally.get(taskId)!;
    const a = { ...A, rate: A.passes / A.trials };
    const b = { ...B, rate: B.passes / B.trials };
    return { taskId, a, b, delta: b.rate - a.rate };
  });

  // 3. Point estimates. Each task counts once, whatever its trial count.
  const deltas = paired.map((t) => t.delta);
  const armStats = (arm: 'a' | 'b') => ({
    passRate: paired.length ? mean(paired.map((t) => t[arm].rate)) : null,
    tasks: paired.length,
    trials: paired.reduce((sum, t) => sum + t[arm].trials, 0),
  });
  const delta = paired.length ? mean(deltas) : null;

  // 4. Interval + verdict, only with enough tasks to mean anything.
  let ci: PairedAnalysis['ci'] = null;
  let verdict: Verdict = 'insufficient_data';
  if (paired.length >= minPaired) {
    const [low, high] = bootstrapCi(deltas, resamples, level, seed);
    ci = { low, high, level };
    verdict = low > 0 ? 'better' : high < 0 ? 'worse' : 'inconclusive';
  }

  const perTask = [...paired].sort(
    (x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.taskId.localeCompare(y.taskId),
  );

  return {
    arms: { A: armStats('a'), B: armStats('b') },
    delta,
    ci,
    verdict,
    pairedTasks: paired.length,
    unpairedTaskIds,
    perTask,
    resamples,
    seed,
  };
}

/**
 * Percentile bootstrap over tasks: resample the per-task deltas with
 * replacement, take each resample's mean, and read the CI off the sorted
 * means. Simple to explain; known to run narrow with few tasks, which is why
 * analyzePaired refuses to give a verdict below minPairedTasks.
 */
function bootstrapCi(deltas: number[], resamples: number, level: number, seed: number): [number, number] {
  const rand = mulberry32(seed);
  const n = deltas.length;
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += deltas[Math.floor(rand() * n)]!;
    means[r] = sum / n;
  }
  means.sort();
  const alpha = 1 - level;
  return [quantile(means, alpha / 2), quantile(means, 1 - alpha / 2)];
}

/** Linear-interpolated quantile of an already-sorted array (the common "type 7" definition). */
function quantile(sorted: Float64Array, p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * Seedable PRNG (mulberry32). Math.random can't be seeded, and the CI must be
 * reproducible from stored runs + the experiment's seed. Not cryptographic;
 * statistically fine for resampling.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
