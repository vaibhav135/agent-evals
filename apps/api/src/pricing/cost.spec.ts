import { describe, expect, it } from 'vitest';
import { computeCost, type TokenUsage } from './cost';

const usage = (u: Partial<TokenUsage>): TokenUsage => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCalls: 1, ...u,
});

// Prices: platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-09), USD per million tokens.
describe('computeCost', () => {
  it('prices the real hello run on Haiku 5.5 (fixture usage)', () => {
    // 6 input × 0.10 + 7482 cache-write × 0.125 + 7152 cache-read × 0.01 + 130 output × 0.50
    // = (0.6 + 935.25 + 71.52 + 65) / 1e6 = 0.00107237
    const cost = computeCost('claude-haiku-5.5', usage({ inputTokens: 6, cacheWriteTokens: 7482, cacheReadTokens: 7152, outputTokens: 130, apiCalls: 2 }));
    expect(cost).not.toBeNull();
    expect(cost!.usd).toBeCloseTo(0.00107237, 9);
    expect(cost!.tier).toBe('standard');
  });

  it('prices Sonnet 5.5 and Opus 5.5', () => {
    const u = usage({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 });
    expect(computeCost('claude-sonnet-5-5', u)!.usd).toBeCloseTo(2 + 10 + 0.1 + 2.5);
    expect(computeCost('claude-opus-5-5', u)!.usd).toBeCloseTo(4 + 20 + 0.2 + 5);
  });

  it('accepts Hermes-style ids: vendor prefix and dots or hyphens', () => {
    const u = usage({ outputTokens: 1_000_000 });
    expect(computeCost('anthropic/claude-haiku-5.5', u)!.usd).toBeCloseTo(0.5);
    expect(computeCost('claude-haiku-5-5', u)!.usd).toBeCloseTo(0.5);
  });

  it('uses Haiku 5.5 long-prompt prices when the average prompt per call exceeds 100K tokens', () => {
    // 2 calls, 250K prompt tokens total → 125K average per call → long-prompt tier.
    const cost = computeCost('claude-haiku-5.5', usage({ inputTokens: 250_000, outputTokens: 1_000_000, apiCalls: 2 }));
    expect(cost!.tier).toBe('long_prompt');
    expect(cost!.usd).toBeCloseTo(0.25 * 0.5 + 2.5); // input $0.50/MTok, output $2.50/MTok
  });

  it('has no long-prompt tier for Sonnet/Opus 5.5 (1M context at standard price)', () => {
    expect(computeCost('claude-sonnet-5.5', usage({ inputTokens: 500_000, apiCalls: 1 }))!.tier).toBe('standard');
  });

  it('zero usage costs zero', () => {
    expect(computeCost('claude-haiku-5.5', usage({ apiCalls: 0 }))).toEqual({ usd: 0, tier: 'standard' });
  });

  it('returns null for an unknown model: unknown cost is not free', () => {
    expect(computeCost('gpt-9', usage({ outputTokens: 100 }))).toBeNull();
  });
});
