import { describe, expect, it } from 'vitest';
import { GraderSpec, type GraderResult } from '@agent-evals/shared';
import {
  gradeDeterministic,
  scoreRun,
  type DeterministicGraderSpec,
  type GradeContext,
  type SessionView,
} from './graders';

// Specs go through the real schema so tests also exercise its defaults.
const spec = (raw: unknown) => GraderSpec.parse(raw) as DeterministicGraderSpec;

function ctx(opts: { sessions?: Partial<SessionView>[]; files?: Record<string, string> } = {}): GradeContext {
  const sessions = (opts.sessions ?? [{}]).map((s) => ({
    finalResponse: s.finalResponse === undefined ? 'done' : s.finalResponse,
    toolCalls: s.toolCalls ?? [],
  }));
  const files = opts.files ?? {};
  return { sessions, readFile: (p) => (p in files ? files[p]! : null) };
}

const grade = (raw: unknown, c: GradeContext) => gradeDeterministic(spec(raw), c);

describe('contains', () => {
  it('passes case-insensitively by default', () => {
    const r = grade({ type: 'contains', value: 'priya shah' }, ctx({ sessions: [{ finalResponse: 'Owner: Priya Shah' }] }));
    expect(r).toMatchObject({ passed: true, score: 1 });
  });

  it('respects caseSensitive', () => {
    const r = grade(
      { type: 'contains', value: 'priya', caseSensitive: true },
      ctx({ sessions: [{ finalResponse: 'Priya' }] }),
    );
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
    expect(r.reason).toContain('"priya"');
  });

  it('reads a workspace file when targeted', () => {
    const r = grade(
      { type: 'contains', target: 'file:out/report.md', value: 'total: 42' },
      ctx({ files: { 'out/report.md': '# Report\ntotal: 42\n' } }),
    );
    expect(r.passed).toBe(true);
  });

  it('fails with a clear reason when the target file is missing', () => {
    const r = grade({ type: 'contains', target: 'file:out/report.md', value: 'x' }, ctx());
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('out/report.md');
    expect(r.reason).toMatch(/not found|missing|does not exist/i);
  });

  it('fails (not crashes) when the session produced no final response', () => {
    const r = grade({ type: 'contains', value: 'x' }, ctx({ sessions: [{ finalResponse: null }] }));
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/no final response/i);
  });
});

describe('regex', () => {
  it('passes when the pattern matches', () => {
    const r = grade({ type: 'regex', pattern: '\\+91-\\d{5}-\\d{5}' }, ctx({ sessions: [{ finalResponse: 'call +91-98765-43210' }] }));
    expect(r.passed).toBe(true);
  });

  it('fails and names the pattern when it does not match', () => {
    const r = grade({ type: 'regex', pattern: '^\\d+$' }, ctx({ sessions: [{ finalResponse: 'abc' }] }));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('^\\d+$');
  });

  it('applies flags', () => {
    const r = grade({ type: 'regex', pattern: '^total', flags: 'im' }, ctx({ sessions: [{ finalResponse: 'x\nTOTAL: 1' }] }));
    expect(r.passed).toBe(true);
  });
});

describe('json_field', () => {
  const files = { 'scored.json': JSON.stringify({ leads: [{ name: 'A', tier: 'hot', score: 87, tags: ['b2b'] }] }) };

  it('passes when the field equals the expected value', () => {
    const r = grade({ type: 'json_field', target: 'file:scored.json', path: 'leads[0].tier', equals: 'hot' }, ctx({ files }));
    expect(r).toMatchObject({ passed: true, score: 1 });
  });

  it('explains a mismatch with expected and actual values', () => {
    const r = grade({ type: 'json_field', target: 'file:scored.json', path: 'leads[0].score', equals: 90 }, ctx({ files }));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('leads[0].score');
    expect(r.reason).toContain('90');
    expect(r.reason).toContain('87');
  });

  it('compares objects and arrays by value', () => {
    const r = grade({ type: 'json_field', target: 'file:scored.json', path: 'leads[0].tags', equals: ['b2b'] }, ctx({ files }));
    expect(r.passed).toBe(true);
  });

  it('supports oneOf', () => {
    const r = grade(
      { type: 'json_field', target: 'file:scored.json', path: 'leads[0].tier', oneOf: ['warm', 'hot'] },
      ctx({ files }),
    );
    expect(r.passed).toBe(true);
  });

  it('fails when the path does not exist', () => {
    const r = grade({ type: 'json_field', target: 'file:scored.json', path: 'leads[3].tier', equals: 'hot' }, ctx({ files }));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('leads[3].tier');
  });

  it('fails (not crashes) on invalid JSON', () => {
    const r = grade(
      { type: 'json_field', target: 'file:scored.json', path: 'a', equals: 1 },
      ctx({ files: { 'scored.json': '{ not json' } }),
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/not valid JSON/i);
  });
});

describe('file_exists', () => {
  it('passes when the file exists, fails when it does not', () => {
    expect(grade({ type: 'file_exists', path: 'out.csv' }, ctx({ files: { 'out.csv': '' } })).passed).toBe(true);
    const r = grade({ type: 'file_exists', path: 'out.csv' }, ctx());
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('out.csv');
  });
});

describe('tool_called', () => {
  const calls = (...names: string[]) => names.map((name) => ({ name }));

  it('passes when the tool was called at least once (default min 1)', () => {
    const r = grade({ type: 'tool_called', tool: 'skill_view' }, ctx({ sessions: [{ toolCalls: calls('read_file', 'skill_view') }] }));
    expect(r.passed).toBe(true);
  });

  it('fails and reports the count when never called', () => {
    const r = grade({ type: 'tool_called', tool: 'skill_view' }, ctx({ sessions: [{ toolCalls: calls('read_file') }] }));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('skill_view');
    expect(r.reason).toContain('0');
  });

  it('enforces max', () => {
    const r = grade(
      { type: 'tool_called', tool: 'terminal', max: 2 },
      ctx({ sessions: [{ toolCalls: calls('terminal', 'terminal', 'terminal') }] }),
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('3');
  });
});

describe('session targeting', () => {
  const twoSessions = ctx({ sessions: [{ finalResponse: 'my name is Asha' }, { finalResponse: 'You are Asha.' }] });

  it('grades the last session by default (how memory tasks are graded)', () => {
    expect(grade({ type: 'contains', value: 'you are asha' }, twoSessions).passed).toBe(true);
  });

  it('can target an earlier session explicitly', () => {
    expect(grade({ type: 'contains', value: 'my name is', session: 0 }, twoSessions).passed).toBe(true);
  });

  it('fails clearly when the session does not exist (e.g. the run stopped early)', () => {
    const r = grade({ type: 'contains', value: 'x', session: 5 }, twoSessions);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/session 5/i);
  });
});

describe('result shape', () => {
  it('carries required and weight from the spec', () => {
    const r = grade({ type: 'contains', value: 'done', required: false, weight: 2 }, ctx());
    expect(r).toMatchObject({ type: 'contains', required: false, weight: 2 });
  });
});

describe('scoreRun', () => {
  const res = (passed: boolean, opts: Partial<GraderResult> = {}): GraderResult => ({
    type: 'contains', required: true, weight: 1, passed, score: passed ? 1 : 0, reason: '', details: {}, ...opts,
  });

  it('passes when every required grader passes', () => {
    expect(scoreRun([res(true), res(true)]).passed).toBe(true);
  });

  it('fails when any required grader fails', () => {
    expect(scoreRun([res(true), res(false)]).passed).toBe(false);
  });

  it('ignores failing non-required (diagnostic) graders for pass/fail', () => {
    expect(scoreRun([res(true), res(false, { required: false })]).passed).toBe(true);
  });

  it('score is the weighted mean of all grader scores', () => {
    // (1*3 + 0*1) / 4 = 0.75
    expect(scoreRun([res(true, { weight: 3 }), res(false)]).score).toBeCloseTo(0.75);
  });

  it('a run with no required graders cannot pass vacuously', () => {
    expect(scoreRun([res(true, { required: false })]).passed).toBe(false);
  });
});
