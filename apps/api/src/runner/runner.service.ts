import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DB, type Db } from '../db/db.module';
import * as schema from '../db/schema';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from './decide-outcome';
import { executeRun, markCompleteIfDone, type ExecuteDeps } from './execute-run';
import { loadHermesEnv } from './hermes-env';
import { claimNext, recoverStale, requeue, type ClaimedRun } from './queue';
import { killDriver } from './spawn-driver';

const IDLE_POLL_MS = 1_000;
const SHUTDOWN_WAIT_MS = 15_000;

/**
 * The worker: claims due runs and executes up to RUNNER_CONCURRENCY at once,
 * inside the API process (one container, no separate queue service).
 *
 * Startup: runs a dead process left `running` are recovered first.
 * Shutdown: stop claiming, kill in-flight Hermes processes, let their
 * attempts be recorded (they come back as retryable infra errors), then let
 * the DB pool close. Anything still `running` is recovered on next boot.
 */
@Injectable()
export class RunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RunnerService.name);
  private readonly active = new Map<string, { promise: Promise<unknown>; child?: ChildProcess }>();
  private stopping = false;
  private deps?: ExecuteDeps;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.RUNNER_ENABLED) {
      this.logger.warn('Runner disabled (RUNNER_ENABLED=false): experiments will stay queued');
      return;
    }
    let hermes;
    try {
      hermes = loadHermesEnv(this.env.HERMES_ENV_FILE);
    } catch (e) {
      this.logger.error(`${(e as Error).message} Runner disabled.`);
      return;
    }
    await mkdir(this.env.RUNS_DIR, { recursive: true });
    const knownSkills = await this.loadSkillNames();

    this.deps = {
      db: this.db,
      hermes,
      anthropicApiKey: this.env.ANTHROPIC_API_KEY,
      runsDir: this.env.RUNS_DIR,
      driverPath: this.env.DRIVER_PATH,
      skillsDir: this.env.SKILLS_DIR,
      knownSkills,
      keepRunDirs: this.env.KEEP_RUN_DIRS,
      log: (m) => this.logger.log(m),
    };

    const recovered = await recoverStale(this.db, MAX_ATTEMPTS);
    if (recovered) this.logger.warn(`Recovered ${recovered} run(s) left running by a previous process`);
    this.logger.log(
      `Runner started: concurrency ${this.env.RUNNER_CONCURRENCY}, Hermes @ ${hermes.hermesCommit.slice(0, 7)}, ` +
        `${knownSkills.size} skill(s): ${[...knownSkills].join(', ') || 'none'}`,
    );
    void this.loop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.active.size === 0) return;
    this.logger.warn(`Shutting down: stopping ${this.active.size} in-flight run(s)`);
    for (const { child } of this.active.values()) if (child) killDriver(child);
    await Promise.race([
      Promise.allSettled([...this.active.values()].map((a) => a.promise)),
      new Promise((r) => setTimeout(r, SHUTDOWN_WAIT_MS)),
    ]);
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      if (this.active.size < this.env.RUNNER_CONCURRENCY) {
        let claimed: ClaimedRun | null = null;
        try {
          claimed = await claimNext(this.db);
        } catch (e) {
          this.logger.error(`claim failed: ${(e as Error).message}`);
        }
        if (claimed) {
          this.start(claimed);
          continue; // try to fill the next free slot right away
        }
      }
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
    }
  }

  private start(claimed: ClaimedRun): void {
    const entry: { promise: Promise<unknown>; child?: ChildProcess } = { promise: Promise.resolve() };
    entry.promise = executeRun({ ...this.deps!, onSpawn: (c) => (entry.child = c) }, claimed)
      .catch((e) => this.onUnexpectedError(claimed, e as Error))
      .finally(() => this.active.delete(claimed.id));
    this.active.set(claimed.id, entry);
  }

  /** A bug or outage in our own glue: same rules as an infra error (retry, then exclude). */
  private async onUnexpectedError(claimed: ClaimedRun, error: Error): Promise<void> {
    this.logger.error(`run ${claimed.id} crashed in the runner: ${error.stack ?? error.message}`);
    try {
      if (claimed.attempt < MAX_ATTEMPTS) {
        await requeue(this.db, claimed.id, RETRY_DELAYS_MS[claimed.attempt - 1] ?? RETRY_DELAYS_MS.at(-1)!);
      } else {
        await this.db
          .update(schema.runs)
          .set({ status: 'infra_error', passed: null, errorKind: 'runner_exception', errorMessage: error.message, finishedAt: new Date() })
          .where(eq(schema.runs.id, claimed.id));
        await markCompleteIfDone(this.db, claimed.experimentId);
      }
    } catch (e) {
      this.logger.error(`could not record the failure of run ${claimed.id}: ${(e as Error).message}`);
    }
  }

  /** Skill folders that contain a SKILL.md. A missing directory just means no skills. */
  private async loadSkillNames(): Promise<Set<string>> {
    try {
      const entries = await readdir(this.env.SKILLS_DIR, { withFileTypes: true });
      return new Set(
        entries.filter((e) => e.isDirectory() && existsSync(join(this.env.SKILLS_DIR, e.name, 'SKILL.md'))).map((e) => e.name),
      );
    } catch {
      return new Set();
    }
  }
}
