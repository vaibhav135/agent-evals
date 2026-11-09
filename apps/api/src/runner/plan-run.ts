/**
 * Turns (agent config + task) into the exact on-disk setup for one Hermes run.
 *
 * This is where "config A vs config B" becomes concrete, so a bug here means
 * comparing the wrong things. It is therefore pure: it returns a plan (files
 * to write, directories to copy, the driver spec) and touches no disk. The
 * runner executes the plan; the tests check it.
 *
 *   <runDir>/home/config.yaml             Hermes settings for this run
 *   <runDir>/home/skills/custom/<name>/   skills under test (copied)
 *   <runDir>/home/memories/MEMORY.md      only when memoryMode = seeded
 *   <runDir>/workspace/...                task fixtures; the agent's cwd
 *   <runDir>/spec.json                    driver input
 *   <runDir>/result.json                  driver output
 */

export interface RunConfig {
  model: string;
  provider: string;
  skills: string[];
  skillMode: 'installed' | 'pinned';
  memoryMode: 'off' | 'on' | 'seeded';
  memorySeed: string | null;
  toolsets: string[];
  maxIterations: number;
  runBudgetS: number;
}

export interface RunTask {
  sessions: { prompt: string }[];
  fixtures: Record<string, string>;
  maxIterations: number;
  timeoutS: number;
}

export interface RunPaths {
  /** Fresh, empty directory owned by this run. */
  runDir: string;
  /** Where skill folders live in this repo (suites/skills/<name>/). */
  skillsSourceDir: string;
}

/** Input for runner/driver.py (see its docstring). */
export interface DriverSpec {
  model: string;
  provider: string;
  enabledToolsets: string[];
  disabledToolsets: string[];
  skipMemory: boolean;
  maxIterations: number;
  runBudgetSeconds: number;
  workspace: string;
  sessions: { prompt: string }[];
  outputPath: string;
}

export interface RunPlan {
  homeDir: string;
  workspaceDir: string;
  specPath: string;
  outputPath: string;
  /** Files to create (parent directories implied). */
  files: { path: string; content: string }[];
  /** Directories to copy recursively. */
  copies: { from: string; to: string }[];
  spec: DriverSpec;
}

export function planRun(
  _config: RunConfig,
  _task: RunTask,
  _paths: RunPaths,
  _knownSkills: ReadonlySet<string>,
): RunPlan {
  throw new Error('not implemented');
}
