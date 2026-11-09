/**
 * Decides whose fault a non-normal run is, which decides whether it is evidence.
 *
 *   infra_error  provider/harness problem: says nothing about the agent →
 *                retried, then EXCLUDED from statistics (and reported)
 *   timeout      the agent exceeded its wall-clock limit → counts as FAILED
 *   agent_error  the agent's own doing (ran out of steps, blew its context,
 *                looped) → counts as FAILED
 *   ok           the run happened normally → graders decide passed/failed
 *
 * Principle: if a different config could have avoided it, it counts against
 * that config. Mistakes in either direction bias the comparison: excluding
 * agent failures flatters a config, counting outages penalises it.
 */
import type { NormalizedRun } from './trace';

export interface ClassifyInput {
  /** Driver process exit code; null if it never exited normally. */
  exitCode: number | null;
  /** True when the runner had to kill the process for exceeding its time limit. */
  timedOut: boolean;
  /** Normalized driver output; null if missing or unreadable. */
  run: NormalizedRun | null;
  /** Why `run` is null (missing file, bad JSON), for the error message. */
  readError?: string;
}

export type RunClassification =
  | { kind: 'ok' }
  | { kind: 'timeout'; errorKind: 'runner_timeout'; message: string }
  | { kind: 'agent_error'; errorKind: string; message: string }
  | {
      kind: 'infra_error';
      errorKind: string;
      message: string;
      /** Worth retrying (transient: rate limit, overload, network). */
      retryable: boolean;
      /** Will fail every run (bad key, no credit, unknown model): stop the experiment. */
      fatal: boolean;
    };

export function classifyRun(_input: ClassifyInput): RunClassification {
  throw new Error('not implemented');
}
