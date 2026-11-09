import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateExperimentRequest, type ExperimentSummary } from '@agent-evals/shared';
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
