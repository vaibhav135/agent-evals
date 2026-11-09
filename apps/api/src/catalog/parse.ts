/**
 * Parses hand-written suite and config YAML into validated snapshots.
 *
 * Pure: file reading is injected, so tests don't touch disk. Everything is
 * strict (unknown keys are errors) and every error names the file and the
 * exact field, because a typo here would silently change WHAT is tested.
 */
import { AgentConfigSnapshot, GraderSpec, type TaskSnapshot } from '@agent-evals/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export class CatalogError extends Error {}

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase letters, digits and dashes');

/** A fixture is inline text, or `{ file: path }` relative to the suite file. */
const Fixture = z.union([z.string(), z.strictObject({ file: z.string().min(1) })]);

const TaskEntry = z
  .strictObject({
    slug: Slug,
    name: z.string().min(1).optional(),
    category: z.enum(['skill', 'control', 'memory']),
    /** Shorthand for a single session. */
    prompt: z.string().min(1).optional(),
    /** Several sessions on the same HERMES_HOME, in order (memory tasks). */
    sessions: z.array(z.string().min(1)).min(1).optional(),
    fixtures: z.record(z.string(), Fixture).default({}),
    graders: z.array(GraderSpec).min(1),
    timeoutS: z.number().int().positive().default(300),
    maxIterations: z.number().int().positive().default(30),
  })
  .refine((t) => (t.prompt === undefined) !== (t.sessions === undefined), {
    message: 'set exactly one of "prompt" or "sessions"',
  });

const SuiteFile = z.strictObject({
  slug: Slug,
  name: z.string().min(1),
  description: z.string().default(''),
  version: z.number().int().positive().default(1),
  tasks: z.array(TaskEntry).min(1),
});

const ConfigFile = z.strictObject({
  ...AgentConfigSnapshot.shape,
  slug: Slug,
  description: z.string().default(''),
});

export interface ParsedSuite {
  slug: string;
  name: string;
  description: string;
  version: number;
  tasks: TaskSnapshot[];
}

export type ParsedConfig = AgentConfigSnapshot & { description: string };

export function parseSuiteFile(
  text: string,
  opts: {
    fileName: string;
    /** Reads a fixture file relative to the suite file; null if missing. */
    readFixture: (relPath: string) => string | null;
  },
): ParsedSuite {
  const file = validate(SuiteFile, readYaml(text, opts.fileName), opts.fileName);

  const seen = new Set<string>();
  const tasks = file.tasks.map((t, i): TaskSnapshot => {
    if (seen.has(t.slug)) throw new CatalogError(`${opts.fileName} → tasks[${i}].slug: duplicate task slug "${t.slug}"`);
    seen.add(t.slug);

    const fixtures: Record<string, string> = {};
    for (const [name, value] of Object.entries(t.fixtures)) {
      if (typeof value === 'string') {
        fixtures[name] = value;
        continue;
      }
      const content = opts.readFixture(value.file);
      if (content === null) {
        throw new CatalogError(`${opts.fileName} → tasks[${i}].fixtures.${name}: fixture file ${value.file} not found`);
      }
      fixtures[name] = content;
    }

    return {
      slug: t.slug,
      name: t.name ?? t.slug,
      category: t.category,
      sessions: (t.sessions ?? [t.prompt!]).map((prompt) => ({ prompt })),
      fixtures,
      graders: t.graders,
      timeoutS: t.timeoutS,
      maxIterations: t.maxIterations,
    };
  });

  return { slug: file.slug, name: file.name, description: file.description, version: file.version, tasks };
}

export function parseConfigFile(text: string, opts: { fileName: string }): ParsedConfig {
  return validate(ConfigFile, readYaml(text, opts.fileName), opts.fileName);
}

function readYaml(text: string, fileName: string): unknown {
  try {
    return parseYaml(text);
  } catch (e) {
    throw new CatalogError(`${fileName}: invalid YAML: ${(e as Error).message}`);
  }
}

function validate<T extends z.ZodType>(schema: T, data: unknown, fileName: string): z.output<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => `  ${fileName} → ${formatPath(issue.path)}: ${issue.message}`);
  throw new CatalogError(`Invalid ${fileName}:\n${lines.join('\n')}`);
}

/** ['tasks', 0, 'graders', 0, 'pattern'] → "tasks[0].graders[0].pattern": points at the exact spot in the YAML. */
function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path
    .map((seg, i) => (typeof seg === 'number' ? `[${seg}]` : i === 0 ? String(seg) : `.${String(seg)}`))
    .join('');
}
