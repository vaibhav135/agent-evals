/**
 * Grader specs: how a task says what "correct" means.
 *
 * Validated when a suite is loaded, so a typo in a task file fails at load
 * time, not silently mid-experiment as if the agent got it wrong.
 */
import { z } from 'zod';

/** What a grader inspects: the agent's final answer, or a file it wrote in the workspace. */
export const GraderTarget = z.union([
  z.literal('final_response'),
  z.string().regex(/^file:.+/, 'must be "final_response" or "file:<path>"'),
]);
export type GraderTarget = z.infer<typeof GraderTarget>;

const base = {
  /** A run passes only if every required grader passes. Non-required graders are diagnostic evidence. */
  required: z.boolean().default(true),
  /** Weight in the run's continuous score (weighted mean of grader scores). */
  weight: z.number().positive().default(1),
  /** Which session to inspect (0-based). Omitted = the last session, which is what memory tasks grade. */
  session: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
};

export const ContainsGrader = z.object({
  type: z.literal('contains'),
  target: GraderTarget.default('final_response'),
  value: z.string().min(1),
  caseSensitive: z.boolean().default(false),
  ...base,
});

export const RegexGrader = z.object({
  type: z.literal('regex'),
  target: GraderTarget.default('final_response'),
  pattern: z.string().min(1).refine(
    (p) => { try { new RegExp(p); return true; } catch { return false; } },
    'is not a valid regular expression',
  ),
  flags: z.string().regex(/^[imsu]*$/, 'only i, m, s, u are allowed').default(''),
  ...base,
});

export const JsonFieldGrader = z
  .object({
    type: z.literal('json_field'),
    target: z.string().regex(/^file:.+/, 'must be "file:<path>"'),
    /** Dot/bracket path into the JSON, e.g. "leads[0].tier". */
    path: z.string().min(1),
    equals: z.json().optional(),
    oneOf: z.array(z.json()).min(1).optional(),
    ...base,
  })
  .refine((g) => (g.equals !== undefined) !== (g.oneOf !== undefined), {
    message: 'set exactly one of "equals" or "oneOf"',
  });

export const FileExistsGrader = z.object({
  type: z.literal('file_exists'),
  path: z.string().min(1),
  ...base,
});

export const ToolCalledGrader = z.object({
  type: z.literal('tool_called'),
  /** Hermes tool name, e.g. "skill_view" (did the agent open the skill?). */
  tool: z.string().min(1),
  min: z.number().int().nonnegative().default(1),
  max: z.number().int().nonnegative().optional(),
  ...base,
});

export const LlmJudgeGrader = z.object({
  type: z.literal('llm_judge'),
  target: GraderTarget.default('final_response'),
  rubric: z.string().min(1),
  /** Judge returns a 0..1 score; at or above this counts as passed. */
  passThreshold: z.number().min(0).max(1).default(0.7),
  ...base,
});

// discriminatedUnion picks the schema from `type`, so `type: regx` fails with
// a clear message instead of a vague "no union member matched".
export const GraderSpec = z.discriminatedUnion('type', [
  ContainsGrader,
  RegexGrader,
  JsonFieldGrader,
  FileExistsGrader,
  ToolCalledGrader,
  LlmJudgeGrader,
]);
export type GraderSpec = z.infer<typeof GraderSpec>;
export type GraderType = GraderSpec['type'];

/** What every grader returns. `reason` is shown in the UI: it must explain the verdict on its own. */
export const GraderResult = z.object({
  type: z.string(),
  required: z.boolean(),
  weight: z.number(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type GraderResult = z.infer<typeof GraderResult>;
