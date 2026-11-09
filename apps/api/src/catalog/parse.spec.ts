import { describe, expect, it } from 'vitest';
import { CatalogError, parseConfigFile, parseSuiteFile } from './parse';

const noFixtures = () => null;
const parse = (yaml: string, readFixture: (p: string) => string | null = noFixtures) =>
  parseSuiteFile(yaml, { fileName: 'demo.suite.yaml', readFixture });

/** Asserts a CatalogError whose message names the file and contains each fragment. */
function expectCatalogError(fn: () => unknown, ...fragments: (string | RegExp)[]) {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(CatalogError);
  const message = (error as Error).message;
  expect(message).toContain('demo.suite.yaml');
  for (const f of fragments) {
    if (typeof f === 'string') expect(message).toContain(f);
    else expect(message).toMatch(f);
  }
}

const minimal = `
slug: demo
name: Demo suite
tasks:
  - slug: hello-file
    category: control
    prompt: Create hello.txt containing hi
    graders:
      - { type: file_exists, path: hello.txt }
`;

describe('parseSuiteFile', () => {
  it('parses a minimal suite, applying task and grader defaults', () => {
    const suite = parse(minimal);
    expect(suite).toMatchObject({ slug: 'demo', name: 'Demo suite', description: '', version: 1 });
    expect(suite.tasks).toEqual([
      {
        slug: 'hello-file',
        name: 'hello-file', // defaults to the slug
        category: 'control',
        sessions: [{ prompt: 'Create hello.txt containing hi' }], // `prompt` shorthand = one session
        fixtures: {},
        graders: [{ type: 'file_exists', path: 'hello.txt', required: true, weight: 1 }],
        timeoutS: 300,
        maxIterations: 30,
      },
    ]);
  });

  it('turns a sessions list into ordered sessions (memory tasks)', () => {
    const suite = parse(`
slug: demo
name: Demo
tasks:
  - slug: remember-name
    category: memory
    sessions:
      - "My name is Asha. Please remember it."
      - "What is my name?"
    graders:
      - { type: contains, value: Asha }
`);
    expect(suite.tasks[0]!.sessions).toEqual([{ prompt: 'My name is Asha. Please remember it.' }, { prompt: 'What is my name?' }]);
  });

  it('resolves fixtures inline or from files next to the suite', () => {
    const reads: string[] = [];
    const suite = parse(
      `
slug: demo
name: Demo
tasks:
  - slug: score
    category: skill
    prompt: Score the leads
    fixtures:
      notes.txt: inline content
      leads.csv: { file: fixtures/leads.csv }
    graders:
      - { type: file_exists, path: scored.json }
`,
      (p) => {
        reads.push(p);
        return p === 'fixtures/leads.csv' ? 'name,budget\nA,100\n' : null;
      },
    );
    expect(reads).toEqual(['fixtures/leads.csv']);
    expect(suite.tasks[0]!.fixtures).toEqual({ 'notes.txt': 'inline content', 'leads.csv': 'name,budget\nA,100\n' });
  });

  it('fails when a fixture file is missing, naming it', () => {
    expectCatalogError(
      () => parse(minimal.replace('    graders:', '    fixtures:\n      a.csv: { file: fixtures/nope.csv }\n    graders:')),
      'fixtures/nope.csv',
    );
  });

  it('requires exactly one of prompt or sessions', () => {
    expectCatalogError(() => parse(minimal.replace('    prompt: Create hello.txt containing hi\n', '')), /prompt|sessions/);
    expectCatalogError(
      () => parse(minimal.replace('    prompt: Create hello.txt containing hi\n', '    prompt: a\n    sessions: [b]\n')),
      /prompt|sessions/,
    );
  });

  it('rejects duplicate task slugs', () => {
    const twice = minimal + minimal.slice(minimal.indexOf('  - slug'));
    expectCatalogError(() => parse(twice), 'hello-file', /duplicate/i);
  });

  it('points at the exact field of an invalid grader', () => {
    expectCatalogError(
      () => parse(minimal.replace('{ type: file_exists, path: hello.txt }', "{ type: regex, pattern: '([' }")),
      'tasks[0].graders[0].pattern',
      'not a valid regular expression',
    );
  });

  it('rejects unknown keys at the task level (typo: grader instead of graders)', () => {
    expectCatalogError(() => parse(minimal.replace('    graders:', '    grader:')), 'grader');
  });

  it('rejects unknown keys inside a grader (typo: caseSensitve)', () => {
    expectCatalogError(
      () => parse(minimal.replace('{ type: file_exists, path: hello.txt }', '{ type: contains, value: hi, caseSensitve: true }')),
      'caseSensitve',
    );
  });

  it('rejects invalid slugs', () => {
    expectCatalogError(() => parse(minimal.replace('slug: hello-file', 'slug: Hello File')), 'slug');
  });

  it('reports YAML syntax errors with the file name', () => {
    expectCatalogError(() => parse('slug: demo\ntasks: [unclosed'));
  });
});

describe('parseConfigFile', () => {
  const cfg = (yaml: string) => parseConfigFile(yaml, { fileName: 'haiku.yaml' });

  it('parses a config, applying defaults', () => {
    expect(
      cfg(`
slug: haiku-baseline
name: Haiku baseline
model: claude-haiku-5.5
toolsets: [file, terminal]
`),
    ).toEqual({
      slug: 'haiku-baseline',
      name: 'Haiku baseline',
      description: '',
      provider: 'anthropic',
      model: 'claude-haiku-5.5',
      skills: [],
      skillMode: 'installed',
      memoryMode: 'off',
      memorySeed: null,
      toolsets: ['file', 'terminal'],
      maxIterations: 30,
      runBudgetS: 300,
    });
  });

  it('rejects unknown keys and missing required fields, naming the file', () => {
    expect(() => cfg('slug: x\nname: X\nmodel: m\ntoolsets: [file]\nskill: [crm]\n')).toThrow(/haiku\.yaml.*skill/s);
    expect(() => cfg('slug: x\nname: X\ntoolsets: [file]\n')).toThrow(/haiku\.yaml.*model/s);
  });
});
