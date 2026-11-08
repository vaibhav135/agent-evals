import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

// Local dev: load the repo-root .env (dist/main.js -> ../../../.env).
// In Docker, compose injects the variables and this file is absent.
const rootEnvFile = resolve(__dirname, '../../../.env');
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // Lets providers clean up (e.g. kill spawned Hermes processes) on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
}

void bootstrap();
