import type { GraderResult, GraderSpec, GraderTarget } from '@agent-evals/shared';

/** One Hermes session, reduced to what graders may inspect. */
export interface SessionView {
  finalResponse: string | null;
  toolCalls: { name: string; args?: unknown }[];
}

/**
 * Everything a grader may look at. `readFile` is injected (not fs access) so
 * graders stay pure: tests pass an in-memory map, the runner passes a reader
 * confined to the run's workspace. Returns null when the file doesn't exist.
 */
export interface GradeContext {
  sessions: SessionView[];
  readFile(path: string): string | null;
}

/** Every grader except llm_judge, which is async and costs money: it has its own path. */
export type DeterministicGraderSpec = Exclude<GraderSpec, { type: 'llm_judge' }>;

/**
 * Grade one spec. Never throws for anything the agent did (missing file, no
 * answer, bad JSON): those are agent failures and must be scored as such. A
 * throw here would surface as an infra error and the run would be EXCLUDED
 * from the statistics, quietly biasing the comparison.
 */
export function gradeDeterministic(spec: DeterministicGraderSpec, ctx: GradeContext): GraderResult {
  const picked = pickSession(spec.session, ctx);
  if ('failure' in picked) return result(spec, false, picked.failure);
  const { session, index } = picked;

  switch (spec.type) {
    case 'contains': {
      const target = readTarget(spec.target, session, index, ctx);
      if ('failure' in target) return result(spec, false, target.failure);
      const norm = (s: string) => (spec.caseSensitive ? s : s.toLowerCase());
      const found = norm(target.text).includes(norm(spec.value));
      return result(
        spec,
        found,
        `${target.label} ${found ? 'contains' : 'does not contain'} "${spec.value}"`,
        { excerpt: excerpt(target.text) },
      );
    }

    case 'regex': {
      const target = readTarget(spec.target, session, index, ctx);
      if ('failure' in target) return result(spec, false, target.failure);
      const matched = new RegExp(spec.pattern, spec.flags).test(target.text);
      return result(
        spec,
        matched,
        `${target.label} ${matched ? 'matches' : 'does not match'} /${spec.pattern}/${spec.flags}`,
        { excerpt: excerpt(target.text) },
      );
    }

    case 'json_field': {
      const target = readTarget(spec.target as GraderTarget, session, index, ctx);
      if ('failure' in target) return result(spec, false, target.failure);
      let doc: unknown;
      try {
        doc = JSON.parse(target.text);
      } catch (e) {
        return result(spec, false, `${target.label} is not valid JSON: ${(e as Error).message}`, {
          excerpt: excerpt(target.text),
        });
      }
      const field = getPath(doc, spec.path);
      if (!field.found) return result(spec, false, `${target.label} has no field ${spec.path}`);

      if (spec.oneOf !== undefined) {
        const ok = spec.oneOf.some((v) => deepEqual(field.value, v));
        return result(
          spec,
          ok,
          ok
            ? `${spec.path} = ${show(field.value)}`
            : `expected ${spec.path} to be one of ${show(spec.oneOf)}, got ${show(field.value)}`,
          { actual: field.value },
        );
      }
      const ok = deepEqual(field.value, spec.equals);
      return result(
        spec,
        ok,
        ok ? `${spec.path} = ${show(field.value)}` : `expected ${spec.path} = ${show(spec.equals)}, got ${show(field.value)}`,
        { actual: field.value, expected: spec.equals },
      );
    }

    case 'file_exists': {
      const exists = ctx.readFile(spec.path) !== null;
      return result(spec, exists, `file ${spec.path} ${exists ? 'exists' : 'not found in the workspace'}`);
    }

    case 'tool_called': {
      const count = session.toolCalls.filter((c) => c.name === spec.tool).length;
      const ok = count >= spec.min && (spec.max === undefined || count <= spec.max);
      const expected = spec.max === undefined ? `≥${spec.min}` : `${spec.min}–${spec.max}`;
      return result(spec, ok, `${spec.tool} called ${count} time(s) in session ${index} (expected ${expected})`, {
        count,
      });
    }
  }
}

/** Run verdict: passes iff every required grader passed; score = weighted mean. */
export function scoreRun(results: GraderResult[]): { passed: boolean; score: number } {
  const required = results.filter((r) => r.required);
  // No required graders => no definition of success => not a pass. Guards
  // against a task file that marks everything diagnostic and "passes" every run.
  const passed = required.length > 0 && required.every((r) => r.passed);
  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
  const score = totalWeight === 0 ? 0 : results.reduce((sum, r) => sum + r.weight * r.score, 0) / totalWeight;
  return { passed, score };
}

// ── helpers ──────────────────────────────────────────────────────────────────

type Failure = { failure: string };

function result(
  spec: DeterministicGraderSpec,
  passed: boolean,
  reason: string,
  details: Record<string, unknown> = {},
): GraderResult {
  return { type: spec.type, required: spec.required, weight: spec.weight, passed, score: passed ? 1 : 0, reason, details };
}

/** Default is the LAST session: memory tasks teach in session 1 and are graded on the final one. */
function pickSession(requested: number | undefined, ctx: GradeContext): { session: SessionView; index: number } | Failure {
  if (ctx.sessions.length === 0) return { failure: 'the run produced no sessions' };
  const index = requested ?? ctx.sessions.length - 1;
  const session = ctx.sessions[index];
  if (!session) {
    return { failure: `session ${index} does not exist (the run has ${ctx.sessions.length}; it may have stopped early)` };
  }
  return { session, index };
}

function readTarget(
  target: GraderTarget,
  session: SessionView,
  index: number,
  ctx: GradeContext,
): { text: string; label: string } | Failure {
  if (target === 'final_response') {
    if (session.finalResponse === null) return { failure: `session ${index} produced no final response` };
    return { text: session.finalResponse, label: 'final response' };
  }
  const path = target.slice('file:'.length);
  const text = ctx.readFile(path);
  if (text === null) return { failure: `file ${path} not found in the workspace` };
  return { text, label: `file ${path}` };
}

/**
 * Resolve a dot/bracket path like `leads[0].tier`.
 *
 * Deliberately not a JSONPath library: we only need property and index
 * access, and a full query language (filters, wildcards) would be more to
 * explain and more ways for a task file to be subtly wrong.
 */
function getPath(doc: unknown, path: string): { found: true; value: unknown } | { found: false } {
  // Tokenize "leads[0].tier" into ["leads", "0", "tier"]: a token is either a
  // run of characters that aren't . [ ], or the digits inside [ ].
  const tokens = [...path.matchAll(/[^.[\]]+|\[(\d+)\]/g)].map((m) => m[1] ?? m[0]);
  let current: unknown = doc;
  for (const token of tokens) {
    if (Array.isArray(current) && /^\d+$/.test(token)) {
      const i = Number(token);
      if (i >= current.length) return { found: false };
      current = current[i];
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, token)) {
      current = (current as Record<string, unknown>)[token];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

/** Structural equality for JSON values (objects/arrays by value, key order irrelevant). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return false;
}

const show = (v: unknown) => JSON.stringify(v);
const excerpt = (s: string, max = 300) => (s.length > max ? `${s.slice(0, max)}…` : s);
