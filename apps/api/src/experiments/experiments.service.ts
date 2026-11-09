import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import {
  AgentConfigSnapshot,
  type CreateExperimentRequest,
  type ExperimentSummary,
  type RunStatus,
  type TaskSnapshot,
} from '@agent-evals/shared';
import { ENV, type Env } from '../config/env';
import { DB, type Db } from '../db/db.module';
import * as schema from '../db/schema';
import { loadHermesEnv } from '../runner/hermes-env';
import { expandExperiment } from './expand';

const RUN_STATUSES: RunStatus[] = ['queued', 'running', 'passed', 'failed', 'agent_error', 'timeout', 'infra_error'];
const INSERT_BATCH = 500;

@Injectable()
export class ExperimentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Freeze both configs into arms, expand into runs, all in one transaction. Starts as `pending`. */
  async create(req: CreateExperimentRequest): Promise<ExperimentSummary> {
    const [suite] = await this.db.select().from(schema.suites).where(eq(schema.suites.slug, req.suite));
    if (!suite) throw new NotFoundException(`suite "${req.suite}" not found`);
    const tasks = await this.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.suiteId, suite.id), eq(schema.tasks.active, true)))
      .orderBy(asc(schema.tasks.slug));
    if (tasks.length === 0) throw new UnprocessableEntityException(`suite "${req.suite}" has no active tasks`);

    // A and B may be the same config: an A/A run is the sanity check that the
    // platform doesn't report differences where there are none.
    const configs = await this.db.select().from(schema.agentConfigs).where(inArray(schema.agentConfigs.slug, [req.configA, req.configB]));
    const snapshotOf = (slug: string) => {
      const c = configs.find((x) => x.slug === slug);
      if (!c) throw new NotFoundException(`config "${slug}" not found`);
      return AgentConfigSnapshot.parse(c);
    };
    const snapshotA = snapshotOf(req.configA);
    const snapshotB = snapshotOf(req.configB);

    const id = await this.db.transaction(async (tx) => {
      const [exp] = await tx
        .insert(schema.experiments)
        .values({
          name: req.name,
          suiteId: suite.id,
          trialsPerTask: req.trialsPerTask,
          status: 'pending',
          hermesCommit: this.hermesCommit(),
          // Stored so re-analysing the same runs always gives the same CI.
          seed: req.seed ?? randomInt(1, 2 ** 31 - 1),
          concurrency: this.env.RUNNER_CONCURRENCY,
        })
        .returning();
      const arms = await tx
        .insert(schema.experimentArms)
        .values([
          { experimentId: exp!.id, label: 'A', configId: configs.find((c) => c.slug === req.configA)!.id, configSnapshot: snapshotA },
          { experimentId: exp!.id, label: 'B', configId: configs.find((c) => c.slug === req.configB)!.id, configSnapshot: snapshotB },
        ])
        .returning();

      const planned = expandExperiment({
        tasks: tasks.map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          category: t.category,
          sessions: t.sessions,
          fixtures: t.fixtures,
          graders: t.graders,
          timeoutS: t.timeoutS,
          maxIterations: t.maxIterations,
        })),
        arms: arms.map((a) => ({ id: a.id, label: a.label })),
        trialsPerTask: req.trialsPerTask,
      });
      for (let i = 0; i < planned.length; i += INSERT_BATCH) {
        await tx.insert(schema.runs).values(
          planned.slice(i, i + INSERT_BATCH).map((r) => ({
            experimentId: exp!.id,
            armId: r.armId,
            taskId: r.taskId,
            trialIndex: r.trialIndex,
            taskSnapshot: r.taskSnapshot as TaskSnapshot,
          })),
        );
      }
      return exp!.id;
    });
    return this.get(id);
  }

  async start(id: string): Promise<ExperimentSummary> {
    return this.transition(id, ['pending'], { status: 'running', startedAt: new Date() }, 'only a pending experiment can be started');
  }

  async cancel(id: string): Promise<ExperimentSummary> {
    // Queued runs of a cancelled experiment are simply never claimed.
    return this.transition(id, ['pending', 'running'], { status: 'cancelled', finishedAt: new Date() }, 'experiment is already finished');
  }

  async list(): Promise<ExperimentSummary[]> {
    const rows = await this.db.select({ id: schema.experiments.id }).from(schema.experiments).orderBy(desc(schema.experiments.createdAt));
    return Promise.all(rows.map((r) => this.get(r.id)));
  }

  async get(id: string): Promise<ExperimentSummary> {
    const [row] = await this.db
      .select({ exp: schema.experiments, suite: schema.suites })
      .from(schema.experiments)
      .innerJoin(schema.suites, eq(schema.suites.id, schema.experiments.suiteId))
      .where(eq(schema.experiments.id, id));
    if (!row) throw new NotFoundException(`experiment ${id} not found`);

    const arms = await this.db.select().from(schema.experimentArms).where(eq(schema.experimentArms.experimentId, id)).orderBy(asc(schema.experimentArms.label));
    const counts = await this.db
      .select({ status: schema.runs.status, n: sql<number>`count(*)::int` })
      .from(schema.runs)
      .where(eq(schema.runs.experimentId, id))
      .groupBy(schema.runs.status);
    const [costRow] = await this.db.select({ cost: sum(schema.runs.costUsd) }).from(schema.runs).where(eq(schema.runs.experimentId, id));

    const progress = Object.fromEntries(RUN_STATUSES.map((s) => [s, 0])) as ExperimentSummary['progress'];
    progress.total = 0;
    for (const c of counts) {
      progress[c.status] = c.n;
      progress.total += c.n;
    }

    const { exp, suite } = row;
    return {
      id: exp.id,
      name: exp.name,
      status: exp.status,
      suite: { slug: suite.slug, name: suite.name },
      arms: arms.map((a) => ({ label: a.label as 'A' | 'B', config: AgentConfigSnapshot.parse(a.configSnapshot) })),
      trialsPerTask: exp.trialsPerTask,
      hermesCommit: exp.hermesCommit,
      seed: exp.seed,
      progress,
      costUsd: Number(costRow?.cost ?? 0),
      createdAt: exp.createdAt.toISOString(),
      startedAt: exp.startedAt?.toISOString() ?? null,
      finishedAt: exp.finishedAt?.toISOString() ?? null,
    };
  }

  private async transition(
    id: string,
    from: (typeof schema.experiments.$inferSelect.status)[],
    set: Partial<typeof schema.experiments.$inferInsert>,
    conflictMessage: string,
  ): Promise<ExperimentSummary> {
    const updated = await this.db
      .update(schema.experiments)
      .set(set)
      .where(and(eq(schema.experiments.id, id), inArray(schema.experiments.status, from)))
      .returning({ id: schema.experiments.id });
    if (updated.length === 0) {
      await this.get(id); // 404 if it doesn't exist
      throw new ConflictException(conflictMessage);
    }
    return this.get(id);
  }

  /** The Hermes build these results will come from (runner/HERMES_COMMIT via setup's env file). */
  private hermesCommit(): string {
    try {
      return loadHermesEnv(this.env.HERMES_ENV_FILE).hermesCommit;
    } catch {
      return 'unknown';
    }
  }
}
