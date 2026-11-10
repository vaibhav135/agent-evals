/**
 * Turns numbers from the API into what a reader acts on. Kept pure (and
 * tested) because the verdict sentence is the experiment's conclusion: a
 * sign error, or "better" shown for an inconclusive result, would misstate it.
 */
import type { ExperimentAnalysis } from '@agent-evals/shared';

const MINUS = '−'; // U+2212: a real minus, same width as "+"

/** Pass-rate difference (−1…1) as signed percentage points: "+50", "−20", "0". */
export function pts(x: number): string {
  const n = Math.round(x * 100);
  if (n === 0) return '0'; // also catches -0
  return n > 0 ? `+${n}` : `${MINUS}${-n}`;
}

export type Tone = 'good' | 'bad' | 'neutral';

export interface VerdictSummary {
  tone: Tone;
  headline: string;
  detail: string;
}

/** Mirrors the API's minimum (analysis/stats.ts): fewer paired tasks → no verdict. */
const MIN_PAIRED_TASKS = 5;

export function verdictSummary(a: ExperimentAnalysis): VerdictSummary {
  if (a.verdict === 'insufficient_data' || a.delta === null || a.ci === null) {
    return {
      tone: 'neutral',
      headline: 'Not enough data yet',
      detail: `${a.pairedTasks} paired tasks finished; at least ${MIN_PAIRED_TASKS} are needed for a verdict`,
    };
  }
  const level = Math.round(a.ci.level * 100);
  const interval = `${pts(a.ci.low)} to ${pts(a.ci.high)}`;
  const effect = `${pts(a.delta)} pts pass rate`;

  if (a.verdict === 'better') return { tone: 'good', headline: 'B is better', detail: `${effect} (${level}% CI ${interval})` };
  if (a.verdict === 'worse') return { tone: 'bad', headline: 'B is worse', detail: `${effect} (${level}% CI ${interval})` };
  return {
    tone: 'neutral',
    headline: 'No clear difference',
    detail: `${effect}, but the ${level}% CI (${interval}) includes 0`,
  };
}

/**
 * Where to draw the interval on a −100…+100 pts axis, as percentages of the
 * axis width (for CSS left/width). Clamped so an extreme bound can't overflow.
 */
export function ciBar(ci: { low: number; high: number; level?: number }, delta: number) {
  const pos = (x: number) => Math.round(((Math.min(1, Math.max(-1, x)) + 1) / 2) * 100);
  const left = pos(ci.low);
  return { left, width: pos(ci.high) - left, point: pos(delta), zero: 50 };
}

/** Run cost: small numbers, so more decimals as they shrink. */
export function usd(x: number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  if (x === 0) return '$0';
  return x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`;
}

export function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
}

export function seconds(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`;
}
