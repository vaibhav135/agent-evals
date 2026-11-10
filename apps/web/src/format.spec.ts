/**
 * The only UI logic worth unit-testing: how an analysis becomes the sentence
 * and interval a reader acts on. A sign error or a "better" shown for an
 * inconclusive result would misstate the experiment's conclusion.
 */
import { describe, expect, it } from 'vitest';
import type { ExperimentAnalysis } from '@agent-evals/shared';
import { ciBar, pts, verdictSummary } from './format';

const analysis = (over: Partial<ExperimentAnalysis>): ExperimentAnalysis => ({
  experimentId: 'e1',
  verdict: 'inconclusive',
  delta: 0,
  ci: { low: 0, high: 0, level: 0.95 },
  arms: [],
  pairedTasks: 14,
  unpairedTaskSlugs: [],
  perTask: [],
  excluded: { infraError: 0, pending: 0 },
  resamples: 10000,
  seed: 1,
  ...over,
});

describe('pts: pass-rate differences as signed percentage points', () => {
  it('signs and rounds, with a real minus sign', () => {
    expect(pts(0.5)).toBe('+50');
    expect(pts(-0.2)).toBe('−20');
    expect(pts(0.1428)).toBe('+14');
    expect(pts(0)).toBe('0');
    expect(pts(-0.001)).toBe('0'); // no "−0"
  });
});

describe('verdictSummary', () => {
  it('better: names B, the effect and the interval', () => {
    const v = verdictSummary(analysis({ verdict: 'better', delta: 0.5, ci: { low: 0.143, high: 0.786, level: 0.95 } }));
    expect(v.tone).toBe('good');
    expect(v.headline).toBe('B is better');
    expect(v.detail).toBe('+50 pts pass rate (95% CI +14 to +79)');
  });

  it('worse', () => {
    const v = verdictSummary(analysis({ verdict: 'worse', delta: -0.2, ci: { low: -0.35, high: -0.05, level: 0.95 } }));
    expect(v.tone).toBe('bad');
    expect(v.headline).toBe('B is worse');
    expect(v.detail).toBe('−20 pts pass rate (95% CI −35 to −5)');
  });

  it('inconclusive never reads as a win, even with a positive point estimate', () => {
    const v = verdictSummary(analysis({ verdict: 'inconclusive', delta: 0.1, ci: { low: -0.05, high: 0.25, level: 0.95 } }));
    expect(v.tone).toBe('neutral');
    expect(v.headline).toBe('No clear difference');
    expect(v.detail).toBe('+10 pts pass rate, but the 95% CI (−5 to +25) includes 0');
  });

  it('insufficient data: says how many paired tasks there are', () => {
    const v = verdictSummary(analysis({ verdict: 'insufficient_data', delta: null, ci: null, pairedTasks: 3 }));
    expect(v.tone).toBe('neutral');
    expect(v.headline).toBe('Not enough data yet');
    expect(v.detail).toBe('3 paired tasks finished; at least 5 are needed for a verdict');
  });
});

describe('ciBar: positions on a −100…+100 pts axis, as percentages of its width', () => {
  it('places the interval, the estimate and zero', () => {
    expect(ciBar({ low: 0.14, high: 0.8, level: 0.95 }, 0.5)).toEqual({ left: 57, width: 33, point: 75, zero: 50 });
  });

  it('clamps to the axis', () => {
    expect(ciBar({ low: -1.2, high: 1.5, level: 0.95 }, 0)).toEqual({ left: 0, width: 100, point: 50, zero: 50 });
  });
});
