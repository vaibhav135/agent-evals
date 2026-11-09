/**
 * Integration test against a real Postgres (the docker compose service).
 * Skipped unless TEST_DATABASE_URL is set; run with `bun run test:int`.
 * Uses its own database so it never touches dev data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as schema from '../db/schema';
import type { Db } from '../db/db.module';
import { setupTestDb } from '../testing/pg-test-db';
import { claimNext, recoverStale, requeue } from './queue';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('run queue (Postgres)', () => {
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    ({ pool, db } = await setupTestDb(url!));
  });

  afterAll(async () => {
    await pool?.end();
  });

  let experimentId: string;
  let armIds: string[];
  let taskId: string;

  beforeEach(async () => {
    await db.execute(sql`truncate suites, agent_configs, experiments restart identity cascade`);
    const [suite] = await db.insert(schema.suites).values({ slug: 's', name: 'S' }).returning();
    const [task] = await db
      .insert(schema.tasks)
      .values({ suiteId: suite!.id, slug: 't', name: 'T', category: 'skill', sessions: [{ prompt: 'p' }], graders: [] })
      .returning();
    taskId = task!.id;
    const [exp] = await db
      .insert(schema.experiments)
      .values({ name: 'e', suiteId: suite!.id, trialsPerTask: 10, status: 'running', hermesCommit: 'abc', seed: 1 })
      .returning();
    experimentId = exp!.id;
    const arms = await db
      .insert(schema.experimentArms)
      .values([
        { experimentId, label: 'A', configSnapshot: {} },
        { experimentId, label: 'B', configSnapshot: {} },
      ])
      .returning();
    armIds = arms.map((a) => a.id);
  });

  async function queueRuns(n: number, over: Partial<typeof schema.runs.$inferInsert> = {}) {
    const rows = Array.from({ length: n }, (_, i) => ({
      experimentId,
      armId: armIds[i % 2]!,
      taskId,
      trialIndex: Math.floor(i / 2),
      taskSnapshot: { slug: 't' },
      ...over,
    }));
    return db.insert(schema.runs).values(rows).returning();
  }

  it('20 concurrent claims get 20 different runs, and a 21st gets none', async () => {
    await queueRuns(20);
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimNext(db)));
    expect(claims.every((c) => c !== null)).toBe(true);
    expect(new Set(claims.map((c) => c!.id)).size).toBe(20); // nobody claimed the same row
    expect(claims.every((c) => c!.attempt === 1)).toBe(true);
    expect(await claimNext(db)).toBeNull();

    const running = await db.select().from(schema.runs).where(eq(schema.runs.status, 'running'));
    expect(running).toHaveLength(20);
  });

  it('returns the snapshot and ids the executor needs', async () => {
    const [run] = await queueRuns(1);
    expect(await claimNext(db)).toEqual({
      id: run!.id, experimentId, armId: armIds[0], taskId, trialIndex: 0, attempt: 1, taskSnapshot: { slug: 't' },
    });
  });

  it('claims earlier trials first', async () => {
    await queueRuns(6); // trials 0,0,1,1,2,2
    const first = await claimNext(db);
    const second = await claimNext(db);
    expect([first!.trialIndex, second!.trialIndex]).toEqual([0, 0]);
  });

  it('skips runs that are not due yet (retry backoff)', async () => {
    await queueRuns(1, { availableAt: new Date(Date.now() + 60_000) });
    expect(await claimNext(db)).toBeNull();
  });

  it('skips runs of experiments that are not running (e.g. cancelled)', async () => {
    await queueRuns(1);
    await db.update(schema.experiments).set({ status: 'cancelled' }).where(eq(schema.experiments.id, experimentId));
    expect(await claimNext(db)).toBeNull();
  });

  it('requeue makes a run claimable again after the delay, counting the next attempt', async () => {
    await queueRuns(1);
    const claimed = await claimNext(db);
    await requeue(db, claimed!.id, 60_000);
    expect(await claimNext(db)).toBeNull(); // not due yet
    await requeue(db, claimed!.id, 0);
    expect((await claimNext(db))!.attempt).toBe(2);
  });

  it('recoverStale requeues runs left running, and gives up on runs out of attempts', async () => {
    await queueRuns(2);
    const a = await claimNext(db);
    const b = await claimNext(db);
    await db.update(schema.runs).set({ attempt: 3 }).where(eq(schema.runs.id, b!.id));

    expect(await recoverStale(db, 3)).toBe(2);
    const [ra] = await db.select().from(schema.runs).where(eq(schema.runs.id, a!.id));
    const [rb] = await db.select().from(schema.runs).where(eq(schema.runs.id, b!.id));
    expect(ra!.status).toBe('queued');
    expect(rb).toMatchObject({ status: 'infra_error', errorKind: 'worker_interrupted', passed: null });
  });
});
