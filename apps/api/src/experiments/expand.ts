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

export function expandExperiment(_input: {
  tasks: ExpandTask[];
  arms: ExpandArm[];
  trialsPerTask: number;
}): PlannedRun[] {
  throw new Error('not implemented');
}
