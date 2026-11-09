/**
 * The job queue is the `runs` table. Plain functions over the Drizzle client
 * (not a Nest service) so the integration test can race them directly.
 */
import { sql } from 'drizzle-orm';
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
export async function claimNext(db: Db): Promise<ClaimedRun | null> {
  // One atomic statement. The inner SELECT picks a candidate row and locks it
  // (FOR UPDATE); SKIP LOCKED makes concurrent workers skip rows another
  // transaction has already locked instead of waiting on them, so N workers
  // claim N different runs with no double-claims and no blocking. The outer
  // UPDATE flips it to running before the lock is released.
  const result = await db.execute<{
    id: string;
    experiment_id: string;
    arm_id: string;
    task_id: string;
    trial_index: number;
    attempt: number;
    task_snapshot: Record<string, unknown>;
  }>(sql`
    update runs
       set status = 'running',
           attempt = attempt + 1,
           claimed_at = now(),
           started_at = coalesce(started_at, now())
     where id = (
       select r.id
         from runs r
         join experiments e on e.id = r.experiment_id
        where r.status = 'queued'
          and r.available_at <= now()      -- retry backoff
          and e.status = 'running'         -- cancelled/failed experiments stop here
        order by r.available_at, r.trial_index, r.created_at
        for update of r skip locked
        limit 1
     )
    returning id, experiment_id, arm_id, task_id, trial_index, attempt, task_snapshot
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    experimentId: row.experiment_id,
    armId: row.arm_id,
    taskId: row.task_id,
    trialIndex: row.trial_index,
    attempt: row.attempt,
    taskSnapshot: row.task_snapshot,
  };
}

/** Put a run back in the queue, claimable after `delayMs` (retry backoff). */
export async function requeue(db: Db, runId: string, delayMs: number): Promise<void> {
  await db.execute(sql`
    update runs
       set status = 'queued',
           claimed_at = null,
           available_at = now() + make_interval(secs => ${delayMs / 1000})
     where id = ${runId}
  `);
}

/**
 * Crash recovery at startup: runs left `running` by a dead process go back
 * to the queue, or to infra_error once out of attempts (so a run that crashes
 * the worker every time can't loop forever). Returns how many were recovered.
 */
export async function recoverStale(db: Db, maxAttempts: number): Promise<number> {
  const result = await db.execute(sql`
    update runs
       set status = case when attempt >= ${maxAttempts} then 'infra_error'::run_status else 'queued'::run_status end,
           claimed_at = null,
           available_at = now(),
           passed = null,
           error_kind = case when attempt >= ${maxAttempts} then 'worker_interrupted' else error_kind end,
           error_message = case when attempt >= ${maxAttempts}
                                then 'the worker stopped mid-run on every attempt' else error_message end
     where status = 'running'
  `);
  return result.rowCount ?? 0;
}
