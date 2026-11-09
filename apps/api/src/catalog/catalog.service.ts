import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DB, type Db } from '../db/db.module';
import * as schema from '../db/schema';
import { CatalogError, parseConfigFile, parseSuiteFile, type ParsedConfig, type ParsedSuite } from './parse';

/**
 * Loads suites/*.suite.yaml and configs/*.yaml into the DB at startup.
 *
 * Runs in onModuleInit, which completes for every module before the app
 * serves requests or the runner claims work, so a broken file stops the
 * boot instead of leaving a half-loaded catalog. Upserts by slug and never
 * deletes (runs reference tasks): tasks dropped from a file become inactive.
 */
@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    const suites = this.readSuites();
    const configs = this.readConfigs();
    this.checkSkillsExist(configs);

    await this.db.transaction(async (tx) => {
      for (const suite of suites) {
        const [row] = await tx
          .insert(schema.suites)
          .values({ slug: suite.slug, name: suite.name, description: suite.description, version: suite.version })
          .onConflictDoUpdate({
            target: schema.suites.slug,
            set: { name: suite.name, description: suite.description, version: suite.version },
          })
          .returning({ id: schema.suites.id });

        for (const t of suite.tasks) {
          const fields = {
            name: t.name, category: t.category, sessions: t.sessions, fixtures: t.fixtures,
            graders: t.graders, timeoutS: t.timeoutS, maxIterations: t.maxIterations, active: true,
          };
          await tx
            .insert(schema.tasks)
            .values({ suiteId: row!.id, slug: t.slug, ...fields })
            .onConflictDoUpdate({ target: [schema.tasks.suiteId, schema.tasks.slug], set: fields });
        }
        // Tasks no longer in the file: keep for history, exclude from new experiments.
        await tx
          .update(schema.tasks)
          .set({ active: false })
          .where(and(eq(schema.tasks.suiteId, row!.id), notInArray(schema.tasks.slug, suite.tasks.map((t) => t.slug))));
      }

      for (const c of configs) {
        const { slug, ...fields } = c;
        await tx.insert(schema.agentConfigs).values({ slug, ...fields }).onConflictDoUpdate({
          target: schema.agentConfigs.slug,
          set: { ...fields, skills: sql`excluded.skills`, toolsets: sql`excluded.toolsets` },
        });
      }
    });

    const taskCount = suites.reduce((n, s) => n + s.tasks.length, 0);
    this.logger.log(
      `Catalog loaded: ${suites.length} suite(s) with ${taskCount} task(s) [${suites.map((s) => s.slug).join(', ')}], ` +
        `${configs.length} config(s) [${configs.map((c) => c.slug).join(', ')}]`,
    );
  }

  private readSuites(): ParsedSuite[] {
    const dir = this.env.SUITES_DIR;
    const files = listFiles(dir, '.suite.yaml');
    const suites = files.map((file) =>
      parseSuiteFile(readFileSync(join(dir, file), 'utf8'), {
        fileName: file,
        readFixture: (rel) => {
          // Fixture files must stay inside the suites directory.
          const path = resolve(dirname(join(dir, file)), rel);
          if (relative(dir, path).startsWith('..') || !existsSync(path)) return null;
          return readFileSync(path, 'utf8');
        },
      }),
    );
    assertUnique(suites.map((s) => s.slug), 'suite');
    return suites;
  }

  private readConfigs(): ParsedConfig[] {
    const dir = this.env.CONFIGS_DIR;
    const configs = listFiles(dir, '.yaml').map((file) => parseConfigFile(readFileSync(join(dir, file), 'utf8'), { fileName: file }));
    assertUnique(configs.map((c) => c.slug), 'config');
    return configs;
  }

  /** A config naming a skill that doesn't exist would silently run a skill-less arm: fail at boot. */
  private checkSkillsExist(configs: ParsedConfig[]): void {
    for (const c of configs) {
      for (const skill of c.skills) {
        if (!existsSync(join(this.env.SKILLS_DIR, skill, 'SKILL.md'))) {
          throw new CatalogError(`config "${c.slug}": skill "${skill}" not found (expected ${join(this.env.SKILLS_DIR, skill, 'SKILL.md')})`);
        }
      }
    }
  }
}

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(suffix)).sort();
}

function assertUnique(slugs: string[], kind: string): void {
  const seen = new Set<string>();
  for (const s of slugs) {
    if (seen.has(s)) throw new CatalogError(`two ${kind} files use the slug "${s}"`);
    seen.add(s);
  }
}
