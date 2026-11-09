import { describe, expect, it } from 'vitest';
import { analyzePaired, type Arm, type TrialOutcome } from './stats';

/** `trials('t1', 'A', 3, 5)` → 5 trials of t1 in arm A, the first 3 passing. */
function trials(taskId: string, arm: Arm, passes: number, total: number): TrialOutcome[] {
  return Array.from({ length: total }, (_, i) => ({ taskId, arm, passed: i < passes }));
}

/** Build a suite where task i has `a[i]` passes in A and `b[i]` in B, out of `n` trials each. */
function suite(a: number[], b: number[], n = 5): TrialOutcome[] {
  return a.flatMap((_, i) => [...trials(`t${i}`, 'A', a[i]!, n), ...trials(`t${i}`, 'B', b[i]!, n)]);
}

describe('verdicts', () => {
  it('identical arms → Δ = 0, CI contains 0, inconclusive', () => {
    const r = analyzePaired(suite([2, 3, 1, 4, 2, 5, 0, 3], [2, 3, 1, 4, 2, 5, 0, 3]));
    expect(r.delta).toBe(0);
    expect(r.ci!.low).toBeLessThanOrEqual(0);
    expect(r.ci!.high).toBeGreaterThanOrEqual(0);
    expect(r.verdict).toBe('inconclusive');
  });

  it('A always fails, B always passes → Δ = 1, better', () => {
    const r = analyzePaired(suite([0, 0, 0, 0, 0, 0], [5, 5, 5, 5, 5, 5]));
    expect(r.delta).toBe(1);
    expect(r.ci).toMatchObject({ low: 1, high: 1 });
    expect(r.verdict).toBe('better');
  });

  it('the reverse → Δ = -1, worse', () => {
    const r = analyzePaired(suite([5, 5, 5, 5, 5, 5], [0, 0, 0, 0, 0, 0]));
    expect(r.delta).toBe(-1);
    expect(r.verdict).toBe('worse');
  });

  it('a consistent gain on most tasks → better (whole CI above 0)', () => {
    // 8 tasks gain +0.4 (1/5 → 3/5), 2 tasks unchanged.
    const r = analyzePaired(suite([1, 1, 1, 1, 1, 1, 1, 1, 2, 2], [3, 3, 3, 3, 3, 3, 3, 3, 2, 2]));
    expect(r.delta).toBeCloseTo(0.32);
    expect(r.ci!.low).toBeGreaterThan(0);
    expect(r.verdict).toBe('better');
  });

  it('gains and losses that cancel out → inconclusive', () => {
    const r = analyzePaired(suite([1, 4, 1, 4, 1, 4, 1, 4, 1, 4], [4, 1, 4, 1, 4, 1, 4, 1, 4, 1]));
    expect(r.delta).toBeCloseTo(0);
    expect(r.verdict).toBe('inconclusive');
  });
});

describe('numbers (hand-computed)', () => {
  // Task rates:       A           B         delta
  //   t0            2/4 = .50   4/4 = 1.0    +.50
  //   t1            1/4 = .25   1/4 = .25     0
  //   t2            0/4 = 0     2/4 = .50    +.50
  //   t3            4/4 = 1.0   3/4 = .75    -.25
  //   t4            3/4 = .75   3/4 = .75     0
  // A passRate = mean(.5,.25,0,1,.75) = .50   B passRate = mean(1,.25,.5,.75,.75) = .65
  // delta      = mean(.5,0,.5,-.25,0) = .15  (= .65 - .50)
  const r = analyzePaired(suite([2, 1, 0, 4, 3], [4, 1, 2, 3, 3], 4));

  it('computes per-arm pass rates, Δ and counts', () => {
    expect(r.arms.A).toEqual({ passRate: 0.5, tasks: 5, trials: 20 });
    expect(r.arms.B.passRate).toBeCloseTo(0.65);
    expect(r.delta).toBeCloseTo(0.15);
    expect(r.pairedTasks).toBe(5);
  });

  it('lists per-task comparisons, largest |Δ| first, ties by task id', () => {
    expect(r.perTask.map((t) => [t.taskId, t.delta])).toEqual([
      ['t0', 0.5],
      ['t2', 0.5],
      ['t3', -0.25],
      ['t1', 0],
      ['t4', 0],
    ]);
    expect(r.perTask[0]).toMatchObject({ a: { passes: 2, trials: 4, rate: 0.5 }, b: { passes: 4, trials: 4, rate: 1 } });
  });

  it('the CI contains the point estimate and stays within [-1, 1]', () => {
    expect(r.ci!.low).toBeLessThanOrEqual(r.delta!);
    expect(r.ci!.high).toBeGreaterThanOrEqual(r.delta!);
    expect(r.ci!.low).toBeGreaterThanOrEqual(-1);
    expect(r.ci!.high).toBeLessThanOrEqual(1);
    expect(r.ci!.level).toBe(0.95);
  });
});

describe('pass rate weighting', () => {
  it('weights every task equally, not every trial (a dropped run must not reweight tasks)', () => {
    // t0: A 1/1 (rate 1), t1: A 0/4 (rate 0). Per-task mean = 0.5; pooled per-trial would be 1/5 = 0.2.
    const outcomes = [
      ...trials('t0', 'A', 1, 1), ...trials('t0', 'B', 1, 1),
      ...trials('t1', 'A', 0, 4), ...trials('t1', 'B', 0, 4),
    ];
    expect(analyzePaired(outcomes).arms.A.passRate).toBe(0.5);
  });
});

describe('pairing', () => {
  it('excludes tasks that only ran in one arm, and reports them', () => {
    const outcomes = [...suite([1, 1, 1, 1, 1], [2, 2, 2, 2, 2]), ...trials('only-a', 'A', 5, 5)];
    const r = analyzePaired(outcomes);
    expect(r.pairedTasks).toBe(5);
    expect(r.unpairedTaskIds).toEqual(['only-a']);
    expect(r.delta).toBeCloseTo(0.2); // the 5/5 unpaired task does not leak in
    expect(r.arms.A.passRate).toBeCloseTo(0.2);
  });

  it('fewer than 5 paired tasks → insufficient_data, no CI', () => {
    const r = analyzePaired(suite([0, 0, 0, 0], [5, 5, 5, 5]));
    expect(r.verdict).toBe('insufficient_data');
    expect(r.ci).toBeNull();
    expect(r.delta).toBe(1); // still reported, just not trusted
  });

  it('no data at all → insufficient_data with null Δ (not 0, which would claim "no effect")', () => {
    const r = analyzePaired([]);
    expect(r.verdict).toBe('insufficient_data');
    expect(r.delta).toBeNull();
    expect(r.arms.A.passRate).toBeNull();
  });

  it('minPairedTasks is configurable', () => {
    expect(analyzePaired(suite([0, 0, 0], [5, 5, 5]), { minPairedTasks: 3 }).verdict).toBe('better');
  });
});

describe('reproducibility', () => {
  const noisy = suite([1, 3, 0, 2, 4, 1, 2, 3, 0, 2], [2, 3, 2, 2, 5, 0, 3, 4, 1, 2]);

  it('same data + same seed → identical CI', () => {
    expect(analyzePaired(noisy, { seed: 42 }).ci).toEqual(analyzePaired(noisy, { seed: 42 }).ci);
  });

  it('input order does not change the result', () => {
    const shuffled = [...noisy].reverse();
    expect(analyzePaired(shuffled, { seed: 7 })).toEqual(analyzePaired(noisy, { seed: 7 }));
  });

  it('records the resample count and seed used', () => {
    const r = analyzePaired(noisy, { seed: 9, resamples: 2000 });
    expect(r).toMatchObject({ seed: 9, resamples: 2000 });
  });
});
