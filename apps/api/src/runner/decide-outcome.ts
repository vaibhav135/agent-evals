/**
 * Final decision for one run attempt: what status to store, or whether to
 * retry. Pulled out of the executor so the retry/exclusion rules, which
 * decide what counts as evidence, are testable on their own.
 */
import type { RunClassification } from './classify';

export const MAX_ATTEMPTS = 3;
/** Backoff before attempt 2, 3, ...: lets a rate-limited provider recover. */
export const RETRY_DELAYS_MS = [15_000, 60_000, 240_000];

export type FinalStatus = 'passed' | 'failed' | 'agent_error' | 'timeout' | 'infra_error';

export type Decision =
  | {
      action: 'complete';
      status: FinalStatus;
      /** null = excluded from statistics (infra_error). */
      passed: boolean | null;
      score: number | null;
      errorKind: string | null;
      errorMessage: string | null;
      /** Stop the whole experiment: every other run would fail the same way. */
      fatal: boolean;
    }
  | { action: 'retry'; delayMs: number; errorKind: string; errorMessage: string };

export function decideOutcome({
  classification: c,
  grading,
  attempt,
  maxAttempts = MAX_ATTEMPTS,
}: {
  classification: RunClassification;
  /** scoreRun() result; null when graders didn't run (infra errors). */
  grading: { passed: boolean; score: number } | null;
  /** 1-based number of the attempt that just finished. */
  attempt: number;
  maxAttempts?: number;
}): Decision {
  switch (c.kind) {
    case 'ok':
      if (!grading) throw new Error('an ok run must have grading results');
      return complete(grading.passed ? 'passed' : 'failed', grading.passed, grading.score, null, null);

    // The agent's own doing: evidence, so it counts as failed and is never
    // retried (a retry would give a flaky agent extra chances). Any grader
    // score is kept to show what was achieved.
    case 'agent_error':
    case 'timeout':
      return complete(c.kind, false, grading?.score ?? 0, c.errorKind, c.message);

    // Says nothing about the agent: retry with backoff, then exclude
    // (passed = null), never score as 0.
    case 'infra_error':
      if (c.retryable && !c.fatal && attempt < maxAttempts) {
        const delayMs = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
        return { action: 'retry', delayMs, errorKind: c.errorKind, errorMessage: c.message };
      }
      return complete('infra_error', null, null, c.errorKind, c.message, c.fatal);
  }
}

function complete(
  status: FinalStatus,
  passed: boolean | null,
  score: number | null,
  errorKind: string | null,
  errorMessage: string | null,
  fatal = false,
): Decision {
  return { action: 'complete', status, passed, score, errorKind, errorMessage, fatal };
}
