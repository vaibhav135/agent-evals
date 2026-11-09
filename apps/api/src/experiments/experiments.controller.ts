import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CreateExperimentRequest, type ExperimentAnalysis, type ExperimentSummary, type RunSummary } from '@agent-evals/shared';
import { ZodPipe } from '../common/zod.pipe';
import { ExperimentsService } from './experiments.service';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Post()
  create(@Body(new ZodPipe(CreateExperimentRequest)) body: CreateExperimentRequest): Promise<ExperimentSummary> {
    return this.experiments.create(body);
  }

  @Get()
  list(): Promise<ExperimentSummary[]> {
    return this.experiments.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ExperimentSummary> {
    return this.experiments.get(id);
  }

  @Get(':id/analysis')
  analysis(@Param('id', ParseUUIDPipe) id: string): Promise<ExperimentAnalysis> {
    return this.experiments.analysis(id);
  }

  @Get(':id/runs')
  runs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('task') task?: string,
    @Query('arm') arm?: string,
  ): Promise<RunSummary[]> {
    if (arm !== undefined && arm !== 'A' && arm !== 'B') throw new BadRequestException('arm must be A or B');
    return this.experiments.runs(id, { task, arm });
  }

  @Post(':id/start')
  @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string): Promise<ExperimentSummary> {
    return this.experiments.start(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<ExperimentSummary> {
    return this.experiments.cancel(id);
  }
}
