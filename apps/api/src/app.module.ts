import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { RunnerModule } from './runner/runner.module';

@Module({
  imports: [ConfigModule, DbModule, CatalogModule, RunnerModule],
  controllers: [HealthController],
})
export class AppModule {}
