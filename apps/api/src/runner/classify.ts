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

// Categories come from Hermes: failure_reason values from
// agent/error_classifier.py, turn_exit_reason values from the agent loop.
// Anything not listed falls through to "infra, retryable" (conservative).

/** failure_reason values caused by what the agent did. */
const AGENT_FAILURES = new Set([
  'context_overflow', // its own context grew too large
  'payload_too_large', // same, as a 413
  'content_policy_blocked', // the model's request was refused
  'incomplete_response', // the model stopped producing an answer
]);

/** failure_reason values that will fail every run: stop rather than retry 200 times. */
const FATAL_FAILURES = new Set(['auth_permanent', 'billing', 'model_not_found', 'model_entitlement', 'ssl_cert_verification']);

/** turn_exit_reason names (text before "(") meaning the agent ran out of steps/budget or looped. */
const AGENT_EXITS = new Set([
  'max_iterations_reached',
  'error_near_max_iterations',
  'budget_exhausted',
  'guardrail_halt',
  'empty_response_exhausted',
  'context_compression_exhausted',
  'compaction_handoff_not_actionable',
]);

/** turn_exit_reason names caused by the provider or the harness. */
const INFRA_EXITS = new Set([
  'all_retries_exhausted_no_response',
  'repeated_outer_errors',
  'interpreter_shutdown',
  'interrupted_by_system',
  'session_persistence_failed',
  'local_processing_error',
  'context_compression_timeout',
  'redirect_restart_limit_exceeded',
  'rebuilt_restart_limit_exceeded',
]);

export function classifyRun({ exitCode, timedOut, run, readError }: ClassifyInput): RunClassification {
  // 1. First: a killed run has no result file, and "no result → infra" must
  //    not excuse an agent that was simply too slow.
  if (timedOut) {
    return { kind: 'timeout', errorKind: 'runner_timeout', message: 'the run exceeded its time limit and was stopped' };
  }

  // 2. The driver itself failed: nothing here describes the agent.
  if (!run) {
    return infra('no_result', readError ?? 'the driver produced no readable result', true);
  }
  if (exitCode !== 0) {
    return infra('driver_exit', `the driver exited with code ${exitCode ?? 'none'}`, true);
  }

  // 3. Per session, in order; the first non-ok session decides.
  for (const s of run.sessions) {
    const at = `session ${s.idx}`;
    if (s.exception) {
      return infra('harness_exception', `${at}: ${s.exception.type}: ${s.exception.message}`, true);
    }
    const o = s.outcome;
    if (o.completed && !o.failed) continue;

    const detail = o.error ? `: ${o.error}` : '';
    if (o.failureReason) {
      const reason = o.failureReason;
      if (AGENT_FAILURES.has(reason)) return agent(reason, `${at}: ${reason}${detail}`);
      if (FATAL_FAILURES.has(reason)) return infra(reason, `${at}: ${reason}${detail}`, false, true);
      return infra(reason, `${at}: ${reason}${detail}`, o.failureRetryable ?? true);
    }

    const exit = o.turnExitReason?.split('(')[0] ?? null;
    if (exit && AGENT_EXITS.has(exit)) return agent(exit, `${at}: ${o.turnExitReason}`);
    if (exit && INFRA_EXITS.has(exit)) return infra(exit, `${at}: ${o.turnExitReason}`, true);
    if (o.partial) return agent('partial_response', `${at}: the agent stopped with a partial answer`);
    return infra('unknown', `${at}: did not complete (${o.turnExitReason ?? 'no exit reason'})${detail}`, true);
  }

  return { kind: 'ok' };
}

function infra(errorKind: string, message: string, retryable: boolean, fatal = false): RunClassification {
  return { kind: 'infra_error', errorKind, message, retryable, fatal };
}

function agent(errorKind: string, message: string): RunClassification {
  return { kind: 'agent_error', errorKind, message };
}
