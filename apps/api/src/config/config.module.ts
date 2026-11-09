import { Global, Module } from '@nestjs/common';
import { ENV, parseEnv } from './env';

/**
 * Parses the environment once at startup and exposes it app-wide under the
 * ENV token. @Global so feature modules can inject it without importing
 * this module everywhere.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
