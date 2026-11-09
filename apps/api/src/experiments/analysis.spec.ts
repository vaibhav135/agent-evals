import { describe, expect, it } from 'vitest';
import type { RunStatus } from '@agent-evals/shared';
import { buildAnalysis, type AnalysisInput, type AnalysisRun } from './analysis';

const arms: AnalysisInput['arms'] = [
  { id: 'arm-a', label: 'A', configSlug: 'haiku-baseline' },
  { id: 'arm-b', label: 'B', configSlug: 'haiku-crm-skill' },
];
const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, slug: `task-${i}`, name: `Task ${i}`, category: 'skill' }));

function run(arm: 'A' | 'B', taskId: string, status: RunStatus, over: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    armId: arm === 'A' ? 'arm-a' : 'arm-b',
    taskId,
    status,
    costUsd: 0.001,
    durationMs: 1000,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 40,
    ...over,
  };
}

const analyze = (runs: AnalysisRun[], taskList = tasks) =>
  buildAnalysis({ experimentId: 'exp-1', seed: 7, arms, tasks: taskList, runs, resamples: 2000 });

describe('status → evidence mapping', () => {
  it('counts agent_error and timeout as failures, not exclusions', () => {
    // On every task: A fails via agent_error or timeout, B passes → B clearly better.
    const runs = tasks.flatMap((t, i) => [run('A', t.id, i % 2 ? 'agent_error' : 'timeout'), run('B', t.id, 'passed')]);
    const a = analyze(runs);
    expect(a.arms.find((x) => x.label === 'A')!.passRate).toBe(0);
    expect(a.delta).toBe(1);
    expect(a.verdict).toBe('better');
    expect(a.excluded).toEqual({ infraError: 0, pending: 0 });
  });

  it('excludes infra errors from the statistics but counts them', () => {
    const runs = tasks.flatMap((t) => [run('A', t.id, 'passed'), run('B', t.id, 'passed'), run('B', t.id, 'infra_error')]);
    const a = analyze(runs);
    expect(a.arms.find((x) => x.label === 'B')!.passRate).toBe(1); // not 0.5: the infra error is not a fail
    expect(a.arms.find((x) => x.label === 'B')!.trials).toBe(6);
    expect(a.excluded.infraError).toBe(6);
  });

  it('leaves unfinished runs out and counts them as pending', () => {
    const runs = [...tasks.flatMap((t) => [run('A', t.id, 'passed'), run('B', t.id, 'failed')]), run('A', 't0', 'queued'), run('B', 't0', 'running')];
    const a = analyze(runs);
    expect(a.excluded.pending).toBe(2);
    expect(a.arms.find((x) => x.label === 'A')!.trials).toBe(6);
  });
});

describe('per-task table', () => {
  it('enriches rows with task slug, name and category, largest change first', () => {
    const runs = [
      ...tasks.flatMap((t) => [run('A', t.id, 'passed'), run('B', t.id, 'passed')]),
      run('A', 't3', 'failed'), run('B', 't3', 'passed'), // t3: A 1/2, B 2/2 → +0.5
    ];
    const a = analyze(runs);
    expect(a.perTask[0]).toMatchObject({ taskId: 't3', slug: 'task-3', name: 'Task 3', category: 'skill', delta: 0.5 });
  });

  it('reports tasks that only ran in one arm by slug', () => {
    const runs = [...tasks.flatMap((t) => [run('A', t.id, 'passed'), run('B', t.id, 'passed')])];
    const extra = { id: 't9', slug: 'only-a', name: 'Only A', category: 'control' };
    const a = analyze([...runs, run('A', 't9', 'passed')], [...tasks, extra]);
    expect(a.unpairedTaskSlugs).toEqual(['only-a']);
    expect(a.pairedTasks).toBe(6);
  });
});

describe('per-arm cost and latency', () => {
  it('sums cost, averages cost/duration/tokens over finished runs, and ignores unknown costs', () => {
    const runs = [
      ...tasks.flatMap((t) => [run('A', t.id, 'passed', { costUsd: 0.002, durationMs: 2000 }), run('B', t.id, 'passed')]),
      run('A', 't0', 'passed', { costUsd: null }), // unknown cost: not counted as $0
      run('A', 't1', 'infra_error', { costUsd: 0.004 }), // still cost money: included in total spend
    ];
    const armA = analyze(runs).arms.find((x) => x.label === 'A')!;
    expect(armA.configSlug).toBe('haiku-baseline');
    expect(armA.costUsd).toBeCloseTo(6 * 0.002 + 0.004);
    expect(armA.meanCostPerRunUsd).toBeCloseTo((6 * 0.002 + 0.004) / 7); // runs with a known cost
    expect(armA.meanDurationMs).toBeCloseTo((6 * 2000 + 1000) / 7); // finished, non-infra runs
    expect(armA.meanTokens).toBe(100);
  });

  it('returns null means for an arm with no finished runs', () => {
    const armB = analyze([run('A', 't0', 'passed'), run('B', 't0', 'queued')]).arms.find((x) => x.label === 'B')!;
    expect(armB).toMatchObject({ meanCostPerRunUsd: null, meanDurationMs: null, meanTokens: null, passRate: null });
  });
});

describe('statistics pass-through', () => {
  it('carries verdict, CI, seed and resamples from the paired analysis', () => {
    const runs = tasks.flatMap((t) => [run('A', t.id, 'passed'), run('B', t.id, 'passed')]);
    const a = analyze(runs);
    expect(a).toMatchObject({ experimentId: 'exp-1', verdict: 'inconclusive', delta: 0, seed: 7, resamples: 2000 });
    expect(a.ci).toMatchObject({ low: 0, high: 0, level: 0.95 });
  });
});
