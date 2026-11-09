/**
 * Expands an experiment into its runs: tasks × arms × trials, each run
 * carrying a frozen snapshot of its task (so later edits to the suite can't
 * change what a stored result was graded against).
 */

export interface ExpandTask {
  id: string;
  slug: string;
  name: string;
  category: string;
  sessions: { prompt: string }[];
  fixtures: Record<string, string>;
  graders: unknown[];
  timeoutS: number;
  maxIterations: number;
}

export interface ExpandArm {
  id: string;
  label: string;
}

export interface PlannedRun {
  armId: string;
  taskId: string;
  trialIndex: number;
  taskSnapshot: Omit<ExpandTask, 'id'>;
}

export function expandExperiment({
  tasks,
  arms,
  trialsPerTask,
}: {
  tasks: ExpandTask[];
  arms: ExpandArm[];
  trialsPerTask: number;
}): PlannedRun[] {
  if (tasks.length === 0) throw new Error('an experiment needs at least one task');
  if (!Number.isInteger(trialsPerTask) || trialsPerTask < 1) {
    throw new Error(`trialsPerTask must be a positive integer, got ${trialsPerTask}`);
  }
  const ordered = [...arms].sort((a, b) => a.label.localeCompare(b.label));
  if (ordered.length !== 2 || ordered[0]!.label !== 'A' || ordered[1]!.label !== 'B') {
    throw new Error('an experiment needs exactly two arms, labelled A and B');
  }
  const sortedTasks = [...tasks].sort((a, b) => a.slug.localeCompare(b.slug));

  // Trial-major, then task, then arm: runs are claimed roughly in this order,
  // so both arms run in the same time window (rate limits, provider drift)
  // rather than all of A first.
  const runs: PlannedRun[] = [];
  for (let trialIndex = 0; trialIndex < trialsPerTask; trialIndex++) {
    for (const { id, ...taskSnapshot } of sortedTasks) {
      for (const arm of ordered) {
        runs.push({ armId: arm.id, taskId: id, trialIndex, taskSnapshot });
      }
    }
  }
  return runs;
}
