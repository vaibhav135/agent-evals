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

export function decideOutcome(_input: {
  classification: RunClassification;
  /** scoreRun() result; null when graders didn't run (infra errors). */
  grading: { passed: boolean; score: number } | null;
  /** 1-based number of the attempt that just finished. */
  attempt: number;
  maxAttempts?: number;
}): Decision {
  throw new Error('not implemented');
}
