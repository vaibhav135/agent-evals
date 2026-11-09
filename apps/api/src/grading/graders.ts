import type { GraderResult, GraderSpec } from '@agent-evals/shared';

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

export function gradeDeterministic(_spec: DeterministicGraderSpec, _ctx: GradeContext): GraderResult {
  throw new Error('not implemented');
}

/** Run verdict: passes iff every required grader passed; score = weighted mean. */
export function scoreRun(_results: GraderResult[]): { passed: boolean; score: number } {
  throw new Error('not implemented');
}
