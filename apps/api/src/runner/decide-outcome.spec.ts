import { describe, expect, it } from 'vitest';
import type { RunClassification } from './classify';
import { decideOutcome, MAX_ATTEMPTS, RETRY_DELAYS_MS } from './decide-outcome';

const ok: RunClassification = { kind: 'ok' };
const infra = (retryable: boolean, fatal = false): RunClassification => ({
  kind: 'infra_error', errorKind: 'rate_limit', message: 'session 0: rate_limit', retryable, fatal,
});
const graded = (passed: boolean, score = passed ? 1 : 0.4) => ({ passed, score });

describe('normal runs', () => {
  it('a graded pass is stored as passed', () => {
    expect(decideOutcome({ classification: ok, grading: graded(true), attempt: 1 })).toEqual({
      action: 'complete', status: 'passed', passed: true, score: 1, errorKind: null, errorMessage: null, fatal: false,
    });
  });

  it('a graded fail is stored as failed, keeping the partial score', () => {
    expect(decideOutcome({ classification: ok, grading: graded(false, 0.4), attempt: 1 })).toMatchObject({
      action: 'complete', status: 'failed', passed: false, score: 0.4,
    });
  });

  it('an ok run without grading is a programming error, not a silent pass', () => {
    expect(() => decideOutcome({ classification: ok, grading: null, attempt: 1 })).toThrow(/grading/i);
  });
});

describe('agent failures count as failed', () => {
  it('agent_error: failed, graders kept as evidence of what was achieved', () => {
    const d = decideOutcome({
      classification: { kind: 'agent_error', errorKind: 'max_iterations_reached', message: 'session 0: max_iterations_reached(30/30)' },
      grading: graded(true, 0.5), // even if graders liked the partial output
      attempt: 1,
    });
    expect(d).toMatchObject({ action: 'complete', status: 'agent_error', passed: false, score: 0.5, errorKind: 'max_iterations_reached' });
  });

  it('timeout: failed, with score 0 when nothing could be graded', () => {
    const d = decideOutcome({
      classification: { kind: 'timeout', errorKind: 'runner_timeout', message: 'stopped' },
      grading: null,
      attempt: 1,
    });
    expect(d).toMatchObject({ action: 'complete', status: 'timeout', passed: false, score: 0 });
  });

  it('agent failures are never retried, even on the first attempt', () => {
    const d = decideOutcome({ classification: { kind: 'agent_error', errorKind: 'x', message: 'x' }, grading: null, attempt: 1 });
    expect(d.action).toBe('complete');
  });
});

describe('infrastructure errors: retry, then exclude', () => {
  it('retries a retryable error with increasing backoff', () => {
    expect(decideOutcome({ classification: infra(true), grading: null, attempt: 1 })).toEqual({
      action: 'retry', delayMs: RETRY_DELAYS_MS[0], errorKind: 'rate_limit', errorMessage: 'session 0: rate_limit',
    });
    expect(decideOutcome({ classification: infra(true), grading: null, attempt: 2 })).toMatchObject({
      action: 'retry', delayMs: RETRY_DELAYS_MS[1],
    });
  });

  it('after the last attempt: infra_error with passed = null (excluded from statistics, not scored 0)', () => {
    expect(decideOutcome({ classification: infra(true), grading: null, attempt: MAX_ATTEMPTS })).toEqual({
      action: 'complete', status: 'infra_error', passed: null, score: null,
      errorKind: 'rate_limit', errorMessage: 'session 0: rate_limit', fatal: false,
    });
  });

  it('a non-retryable error is excluded immediately', () => {
    expect(decideOutcome({ classification: infra(false), grading: null, attempt: 1 })).toMatchObject({
      action: 'complete', status: 'infra_error', passed: null, fatal: false,
    });
  });

  it('a fatal error is excluded immediately and flagged so the experiment stops', () => {
    expect(decideOutcome({ classification: infra(false, true), grading: null, attempt: 1 })).toMatchObject({
      action: 'complete', status: 'infra_error', passed: null, fatal: true,
    });
  });

  it('respects a custom maxAttempts', () => {
    expect(decideOutcome({ classification: infra(true), grading: null, attempt: 1, maxAttempts: 1 }).action).toBe('complete');
  });
});
