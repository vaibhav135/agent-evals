/**
 * Checks the suites and configs we SHIP, not the parser. Task content is where
 * an eval quietly goes wrong: a wrong expected value or a grader that can never
 * (or always) pass shows up as "the model failed", not as a bug. So:
 *
 *   - every task has a golden attempt (suites/golden/<suite>/<task>.yaml) that
 *     must pass: if a correct answer fails, the task is broken, not the model;
 *   - an empty attempt (fixtures only, no answer) must fail every task: no
 *     vacuous passes, no grader matching text the fixture already contains;
 *   - the experiment's two configs differ only in the variable under test.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { gradeDeterministic, scoreRun, type DeterministicGraderSpec, type GradeContext } from '../grading/graders';
import { parseConfigFile, parseSuiteFile, type ParsedConfig, type ParsedSuite } from './parse';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SUITES_DIR = join(REPO_ROOT, 'suites');
const CONFIGS_DIR = join(REPO_ROOT, 'configs');
const GOLDEN_DIR = join(SUITES_DIR, 'golden');
const SKILLS_DIR = join(SUITES_DIR, 'skills');

const suites: ParsedSuite[] = readdirSync(SUITES_DIR)
  .filter((f) => f.endsWith('.suite.yaml'))
  .map((f) =>
    parseSuiteFile(readFileSync(join(SUITES_DIR, f), 'utf8'), {
      fileName: f,
      readFixture: (p) => (existsSync(join(SUITES_DIR, p)) ? readFileSync(join(SUITES_DIR, p), 'utf8') : null),
    }),
  );

const configs: ParsedConfig[] = readdirSync(CONFIGS_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => parseConfigFile(readFileSync(join(CONFIGS_DIR, f), 'utf8'), { fileName: f }));

/** A hand-written correct attempt: what the agent said in each session, and the files it left behind. */
const Golden = z.strictObject({
  sessions: z.array(z.strictObject({ response: z.string(), toolCalls: z.array(z.string()).default([]) })).min(1),
  files: z.record(z.string(), z.string()).default({}),
});

type Task = ParsedSuite['tasks'][number];

function grade(task: Task, ctx: GradeContext) {
  // No llm_judge in shipped suites yet; if one appears this cast is wrong and the test should be extended.
  const results = task.graders.map((g) => gradeDeterministic(g as DeterministicGraderSpec, ctx));
  return { ...scoreRun(results), failures: results.filter((r) => r.required && !r.passed).map((r) => r.reason) };
}

/** Workspace = fixtures, overlaid with what the attempt wrote. */
const ctxFor = (task: Task, sessions: GradeContext['sessions'], written: Record<string, string>): GradeContext => {
  const files = { ...task.fixtures, ...written };
  return { sessions, readFile: (p) => files[p] ?? null };
};

describe.each(suites.map((s) => [s.slug, s] as const))('suite %s', (suiteSlug, suite) => {
  describe.each(suite.tasks.map((t) => [t.slug, t] as const))('task %s', (taskSlug, task) => {
    const goldenPath = join(GOLDEN_DIR, suiteSlug, `${taskSlug}.yaml`);

    it('has a golden attempt that passes every required grader', () => {
      expect(existsSync(goldenPath), `missing ${goldenPath}`).toBe(true);
      const golden = Golden.parse(parseYaml(readFileSync(goldenPath, 'utf8')));
      expect(golden.sessions).toHaveLength(task.sessions.length);

      const sessions = golden.sessions.map((s) => ({ finalResponse: s.response, toolCalls: s.toolCalls.map((name) => ({ name })) }));
      const { passed, failures } = grade(task, ctxFor(task, sessions, golden.files));
      expect(failures).toEqual([]);
      expect(passed).toBe(true);
    });

    it('fails an empty attempt (fixtures only, no answer)', () => {
      const sessions = task.sessions.map(() => ({ finalResponse: null, toolCalls: [] }));
      expect(grade(task, ctxFor(task, sessions, {})).passed).toBe(false);
    });
  });
});

describe('crm-leads suite', () => {
  const suite = suites.find((s) => s.slug === 'crm-leads');

  it('has 8 skill tasks and 6 controls', () => {
    expect(suite).toBeDefined();
    const count = (c: string) => suite!.tasks.filter((t) => t.category === c).length;
    expect({ skill: count('skill'), control: count('control'), memory: count('memory') }).toEqual({ skill: 8, control: 6, memory: 0 });
  });
});

describe('memory suite', () => {
  const suite = suites.find((s) => s.slug === 'memory');

  it('has 4 memory tasks, each spanning at least 2 sessions', () => {
    expect(suite).toBeDefined();
    expect(suite!.tasks).toHaveLength(4);
    for (const t of suite!.tasks) {
      expect(t.category).toBe('memory');
      expect(t.sessions.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('experiment configs', () => {
  const bySlug = (slug: string) => configs.find((c) => c.slug === slug);

  it('ships the crm-lead-handling skill', () => {
    const skillFile = join(SKILLS_DIR, 'crm-lead-handling', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf8')).toMatch(/^---\n[\s\S]*?^name: crm-lead-handling$/m);
  });

  // The comparison is only fair if the skill is the ONLY difference.
  it.each([
    ['haiku-crm-skill', ['skills']],
    ['haiku-memory', ['memoryMode']],
  ])('%s differs from haiku-baseline only in %j', (slug, changed) => {
    const base = bySlug('haiku-baseline');
    const other = bySlug(slug);
    expect(base).toBeDefined();
    expect(other).toBeDefined();

    const ignore = new Set(['slug', 'name', 'description', ...changed]);
    const strip = (c: ParsedConfig) => Object.fromEntries(Object.entries(c).filter(([k]) => !ignore.has(k)));
    expect(strip(other!)).toEqual(strip(base!));
    for (const field of changed) expect(other![field as keyof ParsedConfig]).not.toEqual(base![field as keyof ParsedConfig]);
  });

  it('haiku-crm-skill installs crm-lead-handling', () => {
    expect(bySlug('haiku-crm-skill')?.skills).toEqual(['crm-lead-handling']);
  });
});
