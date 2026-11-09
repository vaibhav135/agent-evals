/**
 * What an experiment freezes at launch. Arms store an AgentConfigSnapshot and
 * every run stores a TaskSnapshot, so later edits to configs or suites can't
 * change what a stored result was produced or graded against. Re-validated
 * when the runner reads them back.
 */
import { z } from 'zod';
import { GraderSpec } from './graders.js';

export const AgentConfigSnapshot = z.object({
  slug: z.string(),
  name: z.string(),
  provider: z.string().default('anthropic'),
  model: z.string().min(1),
  skills: z.array(z.string()).default([]),
  skillMode: z.enum(['installed', 'pinned']).default('installed'),
  memoryMode: z.enum(['off', 'on', 'seeded']).default('off'),
  memorySeed: z.string().nullable().default(null),
  toolsets: z.array(z.string()).min(1),
  maxIterations: z.number().int().positive().default(30),
  runBudgetS: z.number().int().positive().default(300),
});
export type AgentConfigSnapshot = z.infer<typeof AgentConfigSnapshot>;

export const TaskSnapshot = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.enum(['skill', 'control', 'memory']),
  sessions: z.array(z.object({ prompt: z.string().min(1) })).min(1),
  fixtures: z.record(z.string(), z.string()).default({}),
  graders: z.array(GraderSpec).min(1),
  timeoutS: z.number().int().positive().default(300),
  maxIterations: z.number().int().positive().default(30),
});
export type TaskSnapshot = z.infer<typeof TaskSnapshot>;
