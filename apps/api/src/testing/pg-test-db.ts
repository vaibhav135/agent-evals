/**
 * Test-only Postgres helper: creates the test database on first use and
 * applies migrations. Tests pass TEST_DATABASE_URL (a dedicated database,
 * never the dev one).
 */
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import * as schema from '../db/schema';
import type { Db } from '../db/db.module';

export async function setupTestDb(url: string, poolSize = 20): Promise<{ pool: Pool; db: Db }> {
  const target = new URL(url);
  const admin = new Client({ connectionString: url.replace(target.pathname, '/postgres') });
  await admin.connect();
  const dbName = target.pathname.slice(1);
  const exists = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`);
  await admin.end();

  const pool = new Pool({ connectionString: url, max: poolSize });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: resolve(__dirname, '../../drizzle') });
  return { pool, db };
}
