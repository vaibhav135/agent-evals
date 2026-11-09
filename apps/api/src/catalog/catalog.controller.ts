import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import type { ConfigSummary, SuiteDetail, SuiteSummary } from '@agent-evals/shared';
import { DB, type Db } from '../db/db.module';
import * as schema from '../db/schema';

@Controller()
export class CatalogController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('suites')
  async listSuites(): Promise<SuiteSummary[]> {
    const rows = await this.db
      .select({
        slug: schema.suites.slug,
        name: schema.suites.name,
        description: schema.suites.description,
        version: schema.suites.version,
        taskCount: count(schema.tasks.id),
      })
      .from(schema.suites)
      .leftJoin(schema.tasks, and(eq(schema.tasks.suiteId, schema.suites.id), eq(schema.tasks.active, true)))
      .groupBy(schema.suites.id)
      .orderBy(asc(schema.suites.slug));
    return rows;
  }

  @Get('suites/:slug')
  async getSuite(@Param('slug') slug: string): Promise<SuiteDetail> {
    const [suite] = await this.db.select().from(schema.suites).where(eq(schema.suites.slug, slug));
    if (!suite) throw new NotFoundException(`suite "${slug}" not found`);
    const tasks = await this.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.suiteId, suite.id), eq(schema.tasks.active, true)))
      .orderBy(asc(schema.tasks.slug));
    return {
      slug: suite.slug,
      name: suite.name,
      description: suite.description,
      version: suite.version,
      taskCount: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        category: t.category,
        sessions: t.sessions,
        fixtures: t.fixtures,
        graders: t.graders as SuiteDetail['tasks'][number]['graders'],
        timeoutS: t.timeoutS,
        maxIterations: t.maxIterations,
      })),
    };
  }

  @Get('configs')
  async listConfigs(): Promise<ConfigSummary[]> {
    const rows = await this.db.select().from(schema.agentConfigs).orderBy(asc(schema.agentConfigs.slug));
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      provider: c.provider,
      model: c.model,
      skills: c.skills,
      skillMode: c.skillMode,
      memoryMode: c.memoryMode,
      memorySeed: c.memorySeed,
      toolsets: c.toolsets,
      maxIterations: c.maxIterations,
      runBudgetS: c.runBudgetS,
    }));
  }
}
