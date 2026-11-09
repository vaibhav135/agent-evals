/**
 * LIVE end-to-end test: one real Hermes run on Claude Haiku 5.5, through the
 * whole pipeline (claim → plan → driver → classify → grade → cost → DB).
 *
 * Spends real API credit (~$0.001). Skipped unless RUN_LIVE=1; run with
 * `bun run test:live`, which also needs runner/setup-hermes.sh to have run.
 */
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { AgentConfigSnapshot, TaskSnapshot } from '@agent-evals/shared';
import * as schema from '../db/schema';
import type { Db } from '../db/db.module';
import { setupTestDb } from '../testing/pg-test-db';
import { executeRun } from './execute-run';
import { loadHermesEnv } from './hermes-env';
import { claimNext } from './queue';

/** Under $HOME: colima / Docker Desktop only share $HOME with their VM. */
function liveRunsDir(): string {
  const parent = join(homedir(), '.cache');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'live-runs-'));
}

const live = process.env.RUN_LIVE === '1' && !!process.env.TEST_DATABASE_URL;
const REPO_ROOT = resolve(__dirname, '../../../..');

describe.skipIf(!live)('LIVE: one real run through the whole pipeline', () => {
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    // The key comes from the repo-root .env straight into this process; never printed.
    const rootEnv = join(REPO_ROOT, '.env');
    if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
    ({ pool, db } = await setupTestDb(process.env.TEST_DATABASE_URL!));
    await db.execute(sql`truncate suites, agent_configs, experiments restart identity cascade`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('runs, grades, prices and stores a real Hermes run', async () => {
    const task: TaskSnapshot = {
      slug: 'hello-file',
      name: 'Write hello.txt',
      category: 'control',
      sessions: [{ prompt: 'Create a file named hello.txt in the current working directory containing exactly: hi\nThen reply with the single word: done' }],
      fixtures: {},
      graders: [
        { type: 'file_exists', path: 'hello.txt', required: true, weight: 1 },
        { type: 'contains', target: 'file:hello.txt', value: 'hi', caseSensitive: false, required: true, weight: 1 },
        { type: 'contains', target: 'final_response', value: 'done', caseSensitive: false, required: true, weight: 1 },
      ],
      timeoutS: 120,
      maxIterations: 10,
    };
    const config: AgentConfigSnapshot = {
      slug: 'haiku-baseline', name: 'Haiku baseline', provider: 'anthropic', model: 'claude-haiku-5.5',
      skills: [], skillMode: 'installed', memoryMode: 'off', memorySeed: null,
      toolsets: ['file', 'terminal'], maxIterations: 10, runBudgetS: 120,
    };

    const [suite] = await db.insert(schema.suites).values({ slug: 'live', name: 'Live' }).returning();
    const [taskRow] = await db
      .insert(schema.tasks)
      .values({ suiteId: suite!.id, slug: task.slug, name: task.name, category: task.category, sessions: task.sessions, graders: task.graders })
      .returning();
    const [exp] = await db
      .insert(schema.experiments)
      .values({ name: 'live', suiteId: suite!.id, trialsPerTask: 1, status: 'running', hermesCommit: 'f404daf', seed: 1 })
      .returning();
    const [arm] = await db.insert(schema.experimentArms).values({ experimentId: exp!.id, label: 'A', configSnapshot: config }).returning();
    await db.insert(schema.runs).values({ experimentId: exp!.id, armId: arm!.id, taskId: taskRow!.id, trialIndex: 0, taskSnapshot: task });

    const claimed = await claimNext(db);
    expect(claimed).not.toBeNull();

    const decision = await executeRun(
      {
        db,
        hermes: loadHermesEnv(join(REPO_ROOT, 'runner', '.hermes-env.json')),
        anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
        // Under $HOME: colima / Docker Desktop only share $HOME with the VM.
        runsDir: liveRunsDir(),
        driverPath: join(REPO_ROOT, 'runner', 'driver.py'),
        skillsDir: mkdtempSync(join(tmpdir(), 'live-skills-')),
        knownSkills: new Set(),
        keepRunDirs: false,
        sandbox: { kind: 'docker', image: 'python:3.13-slim' },
        log: (m) => console.log(m),
      },
      claimed!,
    );

    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, claimed!.id));
    const sessions = await db.select().from(schema.runSessions).where(eq(schema.runSessions.runId, claimed!.id));
    const grades = await db.select().from(schema.graderResults).where(eq(schema.graderResults.runId, claimed!.id));
    const [expAfter] = await db.select().from(schema.experiments).where(eq(schema.experiments.id, exp!.id));

    // Printed so a failure is diagnosable from the test output alone.
    console.log(JSON.stringify({
      decision,
      run: { status: run?.status, passed: run?.passed, score: run?.score, costUsd: run?.costUsd, tokens: { in: run?.inputTokens, out: run?.outputTokens, cacheR: run?.cacheReadTokens, cacheW: run?.cacheWriteTokens }, durationMs: run?.durationMs, turns: run?.turns, toolCalls: run?.toolCalls, error: run?.errorMessage },
      grades: grades.map((g) => `${g.passed ? 'PASS' : 'FAIL'} ${g.type}: ${g.reason}`),
      finalResponse: sessions[0]?.finalResponse,
      experiment: expAfter?.status,
    }, null, 2));

    expect(decision).toMatchObject({ action: 'complete', status: 'passed' });
    expect(run).toMatchObject({ status: 'passed', passed: true, score: 1, attempt: 1 });
    expect(run!.costUsd).toBeGreaterThan(0);
    expect(run!.outputTokens).toBeGreaterThan(0);
    expect(run!.toolCalls).toBeGreaterThanOrEqual(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.availableTools).toContain('write_file');
    expect(grades).toHaveLength(3);
    expect(grades.every((g) => g.passed)).toBe(true);
    expect(expAfter!.status).toBe('completed');
  }, 240_000);
});
