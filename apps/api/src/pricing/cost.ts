/**
 * USD cost of a run, computed from token counts and our own price table.
 * Hermes's own estimate is not used: it reports cost_status "unknown" for
 * Claude Haiku 5.5 (see test/fixtures/hermes-run-hello.json).
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  apiCalls: number;
}

export interface RunCost {
  usd: number;
  /** Which price tier applied (Haiku 5.5 charges more for prompts over 100K tokens). */
  tier: 'standard' | 'long_prompt';
}

/** Returns null (never 0) for a model we have no prices for: unknown cost is not free. */
export function computeCost(_model: string, _usage: TokenUsage): RunCost | null {
  throw new Error('not implemented');
}
