import { describe, expect, it } from 'vitest';
import { expandExperiment, type ExpandTask } from './expand';

const task = (slug: string): ExpandTask => ({
  id: `id-${slug}`,
  slug,
  name: `Task ${slug}`,
  category: 'skill',
  sessions: [{ prompt: `do ${slug}` }],
  fixtures: { 'in.csv': 'a,b' },
  graders: [{ type: 'file_exists', path: 'out.json' }],
  timeoutS: 300,
  maxIterations: 30,
});
const arms = [
  { id: 'arm-a', label: 'A' },
  { id: 'arm-b', label: 'B' },
];

describe('expandExperiment', () => {
  it('creates one run per task × arm × trial', () => {
    const runs = expandExperiment({ tasks: [task('t1'), task('t2'), task('t3')], arms, trialsPerTask: 5 });
    expect(runs).toHaveLength(3 * 2 * 5);
    const keys = new Set(runs.map((r) => `${r.armId}|${r.taskId}|${r.trialIndex}`));
    expect(keys.size).toBe(runs.length); // no duplicates
  });

  it('orders trial-major, then task, then arm A before B', () => {
    // Runs are claimed roughly in this order, so both arms progress together and
    // see the same time window (rate limits, provider drift) instead of A first.
    const runs = expandExperiment({ tasks: [task('t2'), task('t1')], arms, trialsPerTask: 2 });
    expect(runs.slice(0, 5).map((r) => `${r.trialIndex}:${r.taskId}:${r.armId}`)).toEqual([
      '0:id-t1:arm-a',
      '0:id-t1:arm-b',
      '0:id-t2:arm-a',
      '0:id-t2:arm-b',
      '1:id-t1:arm-a',
    ]);
  });

  it('freezes a full snapshot of the task (minus its id) on every run', () => {
    const [run] = expandExperiment({ tasks: [task('t1')], arms, trialsPerTask: 1 });
    const { id: _id, ...rest } = task('t1');
    expect(run!.taskSnapshot).toEqual(rest);
  });

  it('accepts arms in any order but requires exactly A and B', () => {
    expect(() => expandExperiment({ tasks: [task('t1')], arms: [arms[1]!, arms[0]!], trialsPerTask: 1 })).not.toThrow();
    expect(() => expandExperiment({ tasks: [task('t1')], arms: [arms[0]!], trialsPerTask: 1 })).toThrow(/A and B/);
  });

  it('rejects an empty suite and non-positive or fractional trial counts', () => {
    expect(() => expandExperiment({ tasks: [], arms, trialsPerTask: 1 })).toThrow(/task/i);
    expect(() => expandExperiment({ tasks: [task('t1')], arms, trialsPerTask: 0 })).toThrow(/trials/i);
    expect(() => expandExperiment({ tasks: [task('t1')], arms, trialsPerTask: 1.5 })).toThrow(/trials/i);
  });
});
