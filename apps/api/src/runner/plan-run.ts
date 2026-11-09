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
import { posix } from 'node:path';

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

/**
 * Where the agent's file and terminal tools execute. Hermes does not confine
 * them to the cwd (an outside path only gets a warning), so on the host the
 * agent can read anything: the repo's skills, golden answers, other runs.
 */
export type Sandbox = { kind: 'docker'; image: string } | { kind: 'local' };

export interface RunPaths {
  /** Fresh, empty directory owned by this run. */
  runDir: string;
  /** Where skill folders live in this repo (suites/skills/<name>/). */
  skillsSourceDir: string;
  /** Platform-wide, so identical for both arms. */
  sandbox: Sandbox;
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
  config: RunConfig,
  task: RunTask,
  paths: RunPaths,
  knownSkills: ReadonlySet<string>,
): RunPlan {
  // posix explicitly: these are paths inside a POSIX run dir (macOS/Linux/Docker),
  // and the plan must not depend on the OS the API happens to run on.
  const { join } = posix;
  const homeDir = join(paths.runDir, 'home');
  const workspaceDir = join(paths.runDir, 'workspace');
  const specPath = join(paths.runDir, 'spec.json');
  const outputPath = join(paths.runDir, 'result.json');

  // A typo'd skill must fail loudly: silently running a skill-less "+skill"
  // arm would make the experiment conclude the skill doesn't help.
  const skills = [...new Set(config.skills)];
  for (const name of skills) {
    if (!knownSkills.has(name)) throw new Error(`unknown skill "${name}" (not found in the skills directory)`);
  }

  const memoryOn = config.memoryMode !== 'off';
  if (config.memoryMode === 'seeded' && !config.memorySeed?.trim()) {
    throw new Error('memoryMode "seeded" requires a non-empty memorySeed');
  }

  // Toolsets: `skills` in BOTH arms so only the skill's presence differs;
  // `memory` only when memory is on; `delegation` never (#141318).
  const enabled = new Set(config.toolsets);
  enabled.add('skills');
  enabled.delete('delegation');
  if (memoryOn) enabled.add('memory');
  else enabled.delete('memory');
  const disabled = memoryOn ? ['delegation'] : ['delegation', 'memory'];

  const hermesConfig = {
    memory: {
      // Explicit even when off: Hermes defaults both to true.
      memory_enabled: memoryOn,
      user_profile_enabled: memoryOn,
      nudge_interval: 0,
    },
    skills: {
      creation_nudge_interval: 0,
      ...(config.skillMode === 'pinned' && skills.length ? { auto_load: skills } : {}),
    },
    terminal: terminalConfig(paths.sandbox, workspaceDir),
  };

  const spec: DriverSpec = {
    model: config.model,
    provider: config.provider,
    enabledToolsets: [...enabled].sort(),
    disabledToolsets: disabled.sort(),
    skipMemory: !memoryOn,
    maxIterations: Math.min(config.maxIterations, task.maxIterations),
    runBudgetSeconds: Math.min(config.runBudgetS, task.timeoutS),
    workspace: workspaceDir,
    sessions: task.sessions,
    outputPath,
  };

  const fixtures = Object.entries(task.fixtures)
    .map(([rel, content]) => ({ path: join(workspaceDir, safeFixturePath(rel)), content }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Fixed order (config, memory, fixtures, spec) so plans that mean the same
  // thing compare equal; the single-variable test relies on it.
  const files = [
    // YAML 1.2 is a superset of JSON, so Hermes's YAML loader reads this as-is
    // and we need no YAML library (or its quoting edge cases).
    { path: join(homeDir, 'config.yaml'), content: JSON.stringify(hermesConfig, null, 2) },
    ...(config.memoryMode === 'seeded' ? [{ path: join(homeDir, 'memories', 'MEMORY.md'), content: config.memorySeed! }] : []),
    ...fixtures,
    { path: specPath, content: JSON.stringify(spec, null, 2) },
  ];

  const copies = skills.map((name) => ({
    from: join(paths.skillsSourceDir, name),
    // Hermes reads the category from the parent folder; "custom" is neutral.
    to: join(homeDir, 'skills', 'custom', name),
  }));

  return { homeDir, workspaceDir, specPath, outputPath, files, copies, spec };
}

/**
 * Hermes's `terminal` section. With the docker backend its file tools
 * (read_file, search_files, ...) also run inside the container, so mounting
 * only the workspace confines everything the agent can touch. Skills and
 * memory are read in-process from HERMES_HOME on the host, so they still work.
 */
function terminalConfig(sandbox: Sandbox, workspaceDir: string) {
  if (sandbox.kind === 'local') return { backend: 'local', cwd: workspaceDir };
  return {
    backend: 'docker',
    docker_image: sandbox.image,
    // Explicit volume rather than docker_mount_cwd_to_workspace: that mode
    // derives the host path from the process cwd / TERMINAL_CWD at container
    // creation, so containers created later in a run had no workspace at all.
    docker_volumes: [`${workspaceDir}:/workspace`],
    cwd: '/workspace',
    // Hermes defaults reuse one container across sessions AND processes;
    // that would let one run see another's files.
    container_persistent: false,
    docker_persist_across_processes: false,
    docker_network: false,
  };
}

/** Workspace-relative, normalised, and unable to escape the workspace. */
function safeFixturePath(rel: string): string {
  if (!rel.trim() || posix.isAbsolute(rel)) {
    throw new Error(`fixture path ${JSON.stringify(rel)} must be a non-empty relative path`);
  }
  const normalised = posix.normalize(rel);
  if (normalised === '.' || normalised === '..' || normalised.startsWith('../')) {
    throw new Error(`fixture path ${JSON.stringify(rel)} escapes the workspace`);
  }
  return normalised;
}
