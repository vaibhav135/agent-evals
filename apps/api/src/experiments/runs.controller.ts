import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AgentConfigSnapshot, TaskSnapshot, type RunDetail } from '@agent-evals/shared';
import { DB, type Db } from '../db/db.module';
import * as schema from '../db/schema';
import { toRunSummary } from './experiments.service';

/** Everything needed to understand why one run passed or failed. */
@Controller('runs')
export class RunsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<RunDetail> {
    const [row] = await this.db
      .select({ run: schema.runs, taskSlug: schema.tasks.slug, arm: schema.experimentArms })
      .from(schema.runs)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.runs.taskId))
      .innerJoin(schema.experimentArms, eq(schema.experimentArms.id, schema.runs.armId))
      .where(eq(schema.runs.id, id));
    if (!row) throw new NotFoundException(`run ${id} not found`);

    const sessions = await this.db.select().from(schema.runSessions).where(eq(schema.runSessions.runId, id)).orderBy(asc(schema.runSessions.idx));
    const graders = await this.db.select().from(schema.graderResults).where(eq(schema.graderResults.runId, id)).orderBy(asc(schema.graderResults.graderIdx));
    const { run } = row;

    return {
      ...toRunSummary(run, row.taskSlug, row.arm.label),
      experimentId: run.experimentId,
      // The frozen copies this run actually used, not today's versions.
      config: AgentConfigSnapshot.parse(row.arm.configSnapshot),
      task: TaskSnapshot.parse(run.taskSnapshot),
      errorMessage: run.errorMessage,
      tokens: { input: run.inputTokens, output: run.outputTokens, cacheRead: run.cacheReadTokens, cacheWrite: run.cacheWriteTokens },
      turns: run.turns,
      toolCalls: run.toolCalls,
      sessions: sessions.map((s) => ({
        idx: s.idx,
        prompt: s.prompt,
        finalResponse: s.finalResponse,
        messages: s.messages,
        availableTools: s.availableTools,
        outcome: s.outcome,
        memorySnapshot: s.memorySnapshot ?? null,
        durationMs: s.durationMs,
      })),
      graders: graders.map((g) => ({
        idx: g.graderIdx,
        type: g.type,
        required: g.required,
        passed: g.passed,
        score: g.score,
        reason: g.reason,
        details: g.details,
      })),
    };
  }
}
