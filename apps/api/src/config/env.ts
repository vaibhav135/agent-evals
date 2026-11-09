import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

// src/config or dist/config are both three levels below apps/api's parent.
const REPO_ROOT = resolve(__dirname, '../../../..');

const EnvSchema = z.object({
  // ── Runner ──
  /** Set false to boot the API without the worker (e.g. one-off checks). */
  RUNNER_ENABLED: z.stringbool().default(true),
  /** Runs executed at once. Each is a Hermes process making API calls. */
  RUNNER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /**
   * Parent directory for per-run scratch dirs (HERMES_HOME + workspace).
   * Under $HOME, not the system temp dir: Docker Desktop / colima only share
   * $HOME with their VM, and a bind mount of an unshared path is silently empty.
   */
  RUNS_DIR: z.string().default(join(homedir(), '.cache', 'agent-evals-runs')),
  /**
   * Where the agent's tools run. `docker` (default) confines file and terminal
   * tools to a throwaway container that sees only the run's workspace; `local`
   * runs them on this machine with full access to it (see docs/limits).
   */
  SANDBOX: z.enum(['docker', 'local']).default('docker'),
  /** Image for the docker sandbox. Needs python3 (agents script in it). */
  SANDBOX_IMAGE: z.string().min(1).default('python:3.13-slim'),
  /** Keep run dirs after completion, for debugging. */
  KEEP_RUN_DIRS: z.stringbool().default(false),
  /** Written by runner/setup-hermes.sh: how to launch Hermes. */
  HERMES_ENV_FILE: z.string().default(join(REPO_ROOT, 'runner', '.hermes-env.json')),
  DRIVER_PATH: z.string().default(join(REPO_ROOT, 'runner', 'driver.py')),
  /** Skill folders available to configs (suites/skills/<name>/SKILL.md). */
  SKILLS_DIR: z.string().default(join(REPO_ROOT, 'suites', 'skills')),
  /** *.suite.yaml files, loaded at startup. */
  SUITES_DIR: z.string().default(join(REPO_ROOT, 'suites')),
  /** Agent config *.yaml files, loaded at startup. */
  CONFIGS_DIR: z.string().default(join(REPO_ROOT, 'configs')),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // `error` covers the missing case; .min(1) covers `ANTHROPIC_API_KEY=` (empty).
  ANTHROPIC_API_KEY: z
    .string({ error: 'is required (the only provider this project is tested with)' })
    .min(1, 'is required (the only provider this project is tested with)'),
});

export type Env = z.infer<typeof EnvSchema>;

/** DI token for the validated environment. Inject with `@Inject(ENV) env: Env`. */
export const ENV = Symbol('ENV');

/**
 * Validates raw environment variables. Throws one error listing every
 * problem at once, so a misconfigured deploy fails at startup with the
 * full picture rather than one variable at a time.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${problems}`);
}
