# Costs

All costs are computed by the platform from Hermes's token counts (`apps/api/src/pricing/cost.ts`), using Anthropic's published prices as of 2026-11-09. Hermes itself reports `cost_status: unknown` for Haiku 5.5.

**Prices, USD per million tokens:**

| Model | Input | Cache write (5 min) | Cache read | Output |
|---|---|---|---|---|
| Haiku 5.5 (prompt ≤ 100K) | 0.10 | 0.125 | 0.01 | 0.50 |
| Haiku 5.5 (prompt > 100K) | 0.50 | 0.625 | 0.05 | 2.50 |
| Sonnet 5.5 | 2 | 2.50 | 0.10 | 10 |
| Opus 5.5 | 4 | 5 | 0.20 | 20 |

## What was spent

| Experiment | Runs | Cost |
|---|---|---|
| **Main experiment** (5 trials × 14 tasks × 2 arms) | 140 | **$0.175** |
| Pilot 1, unsandboxed (contaminated, see results) | 28 | $0.042 |
| Pilot 2, sandbox mount bug, cancelled | 15 of 28 | $0.017 |
| Pilot 3, sandboxed | 28 | $0.034 |
| Sandbox smoke | 4 | $0.002 |
| Live end-to-end tests during development | 2 | ≈ $0.002 |
| **Total** | | **≈ $0.27** |

## Where the money goes (main experiment)

| Token type | Tokens | Cost | Share |
|---|---|---|---|
| Output | 153,727 | $0.077 | 44% |
| Cache write | 451,652 | $0.056 | 32% |
| Cache read | 4,178,442 | $0.042 | 24% |
| Uncached input | 1,342 | < $0.001 | 0% |

- **Per run:** about $0.00125, with about 33k tokens across about 4 model calls. The maximum single run was $0.0032.
- **Most input is Hermes's own system prompt** (tool schemas and the skills index), about 7k tokens resent on every call. Prompt caching turns that into cache reads at a tenth of the input price, so caching is what keeps runs this cheap.
- **Wall-clock time:** 18 minutes for 140 runs at concurrency 4, about 25s per run on average, including container start.

## Rough cost for other models

These assume the same token counts; a different model would also take a different number of turns.

| Model | 140-run experiment |
|---|---|
| Haiku 5.5 | $0.18 (measured) |
| Sonnet 5.5 | ≈ $3.10 |
| Opus 5.5 | ≈ $6.20 |

An experiment costs roughly **tasks × 2 arms × trials × (cost per run)**. Run a 1-trial pilot first; it costs a fifth as much as a 5-trial run.

## Caveats

- **The Haiku price tier is approximated.** It's chosen by the *average* prompt size per call in a run, not per call. Every run here stayed far below 100K tokens, so this didn't matter.
- **Failed attempts still count.** The cost of infrastructure-error attempts is included in an experiment's total, because they cost money, but excluded from the pass-rate statistics.
- Prices are hard-coded in `pricing/cost.ts` and need updating when Anthropic changes them. An unknown model gets a cost of `null` rather than $0.
