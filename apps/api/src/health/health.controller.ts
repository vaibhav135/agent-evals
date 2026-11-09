import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@agent-evals/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok', version: process.env.npm_package_version ?? 'dev' };
  }
}
