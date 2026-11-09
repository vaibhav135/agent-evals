/**
 * The job queue is the `runs` table. Plain functions over the Drizzle client
 * (not a Nest service) so the integration test can race them directly.
 */
import type { Db } from '../db/db.module';

export interface ClaimedRun {
  id: string;
  experimentId: string;
  armId: string;
  taskId: string;
  trialIndex: number;
  /** 1-based: this claim's attempt number. */
  attempt: number;
  taskSnapshot: Record<string, unknown>;
}

/** Claim the next due queued run of a running experiment, or null if none. Safe under concurrency. */
export async function claimNext(_db: Db): Promise<ClaimedRun | null> {
  throw new Error('not implemented');
}

/** Put a run back in the queue, claimable after `delayMs` (retry backoff). */
export async function requeue(_db: Db, _runId: string, _delayMs: number): Promise<void> {
  throw new Error('not implemented');
}

/**
 * Crash recovery at startup: runs left `running` by a dead process go back
 * to the queue, or to infra_error once out of attempts (so a run that crashes
 * the worker every time can't loop forever). Returns how many were recovered.
 */
export async function recoverStale(_db: Db, _maxAttempts: number): Promise<number> {
  throw new Error('not implemented');
}
