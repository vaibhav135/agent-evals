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

/** USD per million tokens. Cache writes are the 5-minute TTL price. */
interface Prices {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/**
 * Source: platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-09.
 * Re-check when adding a model; an unlisted model gets null cost, not 0.
 */
const PRICES: Record<string, { standard: Prices; longPrompt?: { overTokens: number; prices: Prices } }> = {
  'claude-haiku-5-5': {
    standard: { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
    // Haiku 5.5 alone charges more when a single request's prompt exceeds 100K tokens.
    longPrompt: { overTokens: 100_000, prices: { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 } },
  },
  'claude-sonnet-5-5': { standard: { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 } },
  'claude-opus-5-5': { standard: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 } },
};

/** Returns null (never 0) for a model we have no prices for: unknown cost is not free. */
export function computeCost(model: string, usage: TokenUsage): RunCost | null {
  const entry = PRICES[normalizeModelId(model)];
  if (!entry) return null;

  // The long-prompt tier is decided per API request, but Hermes reports
  // per-session totals, so we use the average prompt size per call. Exact for
  // single-call sessions; an approximation otherwise (documented limit).
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const avgPrompt = usage.apiCalls > 0 ? promptTokens / usage.apiCalls : 0;
  const long = entry.longPrompt && avgPrompt > entry.longPrompt.overTokens;
  const p = long ? entry.longPrompt!.prices : entry.standard;

  const usd =
    (usage.inputTokens * p.input +
      usage.cacheWriteTokens * p.cacheWrite +
      usage.cacheReadTokens * p.cacheRead +
      usage.outputTokens * p.output) /
    1_000_000;
  return { usd, tier: long ? 'long_prompt' : 'standard' };
}

/** "anthropic/claude-haiku-5.5" and "claude-haiku-5-5" are the same model to Hermes; same here. */
function normalizeModelId(model: string): string {
  return model.replace(/^anthropic\//, '').replaceAll('.', '-');
}
