import { describe, expect, it } from 'vitest';
import { classifyRun, type ClassifyInput } from './classify';
import type { NormalizedRun, NormalizedSession } from './trace';

type Outcome = NormalizedSession['outcome'];

function sessionWith(outcome: Partial<Outcome> = {}, exception: NormalizedSession['exception'] = null): NormalizedSession {
  return {
    idx: 0,
    prompt: 'p',
    finalResponse: 'ok',
    toolCalls: [],
    messages: [],
    availableTools: [],
    memorySnapshot: null,
    outcome: {
      completed: true, failed: false, partial: false, error: null,
      failureReason: null, failureRetryable: null, turnExitReason: 'text_response(finish_reason=stop)',
      ...outcome,
    },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCalls: 1 },
    durationMs: 10,
    exception,
  };
}

const runOf = (...sessions: NormalizedSession[]): NormalizedRun => ({
  sessions: sessions.map((s, idx) => ({ ...s, idx })),
  totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCalls: 0, toolCalls: 0, durationMs: 0 },
});

const classify = (over: Partial<ClassifyInput>) =>
  classifyRun({ exitCode: 0, timedOut: false, run: runOf(sessionWith()), ...over });

const failed = (failureReason: string, failureRetryable: boolean | null = true) =>
  sessionWith({ completed: false, failed: true, failureReason, failureRetryable, error: `${failureReason} happened` });

describe('normal runs', () => {
  it('a completed run is ok (graders decide passed/failed)', () => {
    expect(classify({})).toEqual({ kind: 'ok' });
  });

  it('every session must be ok in a multi-session run', () => {
    expect(classify({ run: runOf(sessionWith(), sessionWith()) })).toEqual({ kind: 'ok' });
  });
});

describe('timeout comes first', () => {
  it('a run the runner had to kill is a timeout and counts against the agent, even with no result file', () => {
    // Without this ordering, "no result file → infra" would excuse a slow agent.
    expect(classify({ timedOut: true, run: null, exitCode: null })).toMatchObject({ kind: 'timeout', errorKind: 'runner_timeout' });
  });
});

describe('infrastructure (excluded from statistics)', () => {
  it('no readable result is an infra error, retryable', () => {
    expect(classify({ run: null, readError: 'result.json missing' })).toMatchObject({
      kind: 'infra_error', retryable: true, fatal: false,
    });
  });

  it('a non-zero driver exit is an infra error even if a result exists', () => {
    expect(classify({ exitCode: 1 })).toMatchObject({ kind: 'infra_error', retryable: true });
  });

  it('a Python exception inside a session is a harness crash', () => {
    const r = classify({ run: runOf(sessionWith({ completed: false }, { type: 'ImportError', message: 'no anthropic' })) });
    expect(r).toMatchObject({ kind: 'infra_error', errorKind: 'harness_exception' });
    expect('message' in r && r.message).toContain('no anthropic');
  });

  it.each(['rate_limit', 'overloaded', 'server_error', 'timeout', 'upstream_rate_limit'])(
    'provider-side failure %s is infra and retryable',
    (reason) => {
      expect(classify({ run: runOf(failed(reason)) })).toMatchObject({ kind: 'infra_error', errorKind: reason, retryable: true, fatal: false });
    },
  );

  it.each(['auth_permanent', 'billing', 'model_not_found', 'model_entitlement'])(
    '%s will fail every run: fatal, not retried (stop instead of burning the whole experiment)',
    (reason) => {
      expect(classify({ run: runOf(failed(reason, true)) })).toMatchObject({ kind: 'infra_error', retryable: false, fatal: true });
    },
  );

  it('respects Hermes saying a provider failure is not retryable', () => {
    expect(classify({ run: runOf(failed('server_error', false)) })).toMatchObject({ kind: 'infra_error', retryable: false });
  });

  it('an unknown or unrecognised failure reason is infra and retryable (conservative; exclusions are reported)', () => {
    expect(classify({ run: runOf(failed('unknown')) })).toMatchObject({ kind: 'infra_error', retryable: true });
    expect(classify({ run: runOf(failed('some_future_reason')) })).toMatchObject({ kind: 'infra_error', retryable: true });
  });

  it.each(['all_retries_exhausted_no_response', 'repeated_outer_errors', 'interpreter_shutdown'])(
    'infrastructure exit reason %s is infra',
    (exit) => {
      const r = classify({ run: runOf(sessionWith({ completed: false, turnExitReason: `${exit}(details)` })) });
      expect(r).toMatchObject({ kind: 'infra_error' });
    },
  );
});

describe('agent failures (count as failed)', () => {
  it.each(['context_overflow', 'content_policy_blocked', 'incomplete_response', 'payload_too_large'])(
    'agent-caused failure %s is an agent_error',
    (reason) => {
      expect(classify({ run: runOf(failed(reason)) })).toMatchObject({ kind: 'agent_error', errorKind: reason });
    },
  );

  it.each([
    ['max_iterations_reached(30/30)', 'max_iterations_reached'],
    ['error_near_max_iterations', 'error_near_max_iterations'],
    ['budget_exhausted(300s)', 'budget_exhausted'],
    ['guardrail_halt(loop)', 'guardrail_halt'],
    ['empty_response_exhausted', 'empty_response_exhausted'],
  ])('running out of steps/budget or looping (%s) is an agent_error', (exit, kind) => {
    const r = classify({ run: runOf(sessionWith({ completed: false, partial: true, turnExitReason: exit })) });
    expect(r).toMatchObject({ kind: 'agent_error', errorKind: kind });
  });

  it('a partial answer with no other explanation is an agent_error', () => {
    expect(classify({ run: runOf(sessionWith({ completed: false, partial: true, turnExitReason: null })) })).toMatchObject({
      kind: 'agent_error', errorKind: 'partial_response',
    });
  });
});

describe('multi-session runs', () => {
  it('the first non-ok session decides', () => {
    const r = classify({ run: runOf(sessionWith(), failed('rate_limit'), failed('context_overflow')) });
    expect(r).toMatchObject({ kind: 'infra_error', errorKind: 'rate_limit' });
    expect('message' in r && r.message).toMatch(/session 1/);
  });
});
