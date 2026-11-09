import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeResult, toSessionViews, TraceFormatError } from './trace';

// Verbatim output of runner/driver.py from a real Haiku run (see the fixture's _fixture note).
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../test/fixtures/hermes-run-hello.json'), 'utf8'));

describe('normalizeResult on a real Hermes run', () => {
  const run = normalizeResult(fixture);
  const s = run.sessions[0]!;

  it('extracts the session basics', () => {
    expect(run.sessions).toHaveLength(1);
    expect(s).toMatchObject({ idx: 0, finalResponse: 'done', exception: null });
    expect(s.prompt).toContain('hello.txt');
  });

  it('pairs each tool call with its result by tool_call_id, parsing JSON arguments', () => {
    expect(s.toolCalls).toHaveLength(1);
    const call = s.toolCalls[0]!;
    expect(call).toMatchObject({ id: 'toolu_019YkHEhjmyHBEmAut8Fiitk', name: 'write_file' });
    expect(call.args).toMatchObject({ path: '<RUN>/workspace/hello.txt', content: 'hi' });
    expect(call.result).toContain('"bytes_written": 2');
  });

  it('maps outcome flags', () => {
    expect(s.outcome).toEqual({
      completed: true,
      failed: false,
      partial: false,
      error: null,
      failureReason: null,
      failureRetryable: null,
      turnExitReason: 'text_response(finish_reason=stop)',
    });
  });

  it('maps usage and totals', () => {
    expect(s.usage).toEqual({ inputTokens: 6, outputTokens: 130, cacheReadTokens: 7152, cacheWriteTokens: 7482, apiCalls: 2 });
    expect(run.totals).toEqual({
      inputTokens: 6,
      outputTokens: 130,
      cacheReadTokens: 7152,
      cacheWriteTokens: 7482,
      apiCalls: 2,
      toolCalls: 1,
      durationMs: s.durationMs,
    });
  });

  it('keeps the raw transcript and the tools that were available', () => {
    expect(s.messages).toHaveLength(4);
    expect(s.availableTools).toEqual(expect.arrayContaining(['write_file', 'skill_view', 'skills_list']));
  });

  it('produces grader views', () => {
    expect(toSessionViews(run)).toEqual([
      { finalResponse: 'done', toolCalls: [{ name: 'write_file', args: { path: '<RUN>/workspace/hello.txt', content: 'hi' } }] },
    ]);
  });
});

describe('normalizeResult edge cases', () => {
  const session = (over: Record<string, unknown> = {}) => ({
    index: 0, prompt: 'p', final_response: 'ok', messages: [], available_tools: [], completed: true, duration_ms: 10, ...over,
  });
  const assistantCall = (id: string | undefined, name: string, args: string) => ({
    role: 'assistant', content: '', tool_calls: [{ ...(id ? { id } : {}), type: 'function', function: { name, arguments: args } }],
  });

  it('a call with no result message gets result null', () => {
    const run = normalizeResult({ sessions: [session({ messages: [assistantCall('c1', 'terminal', '{"command":"ls"}')] })] });
    expect(run.sessions[0]!.toolCalls[0]).toEqual({ id: 'c1', name: 'terminal', args: { command: 'ls' }, result: null });
  });

  it('keeps malformed arguments as the raw string instead of crashing', () => {
    const run = normalizeResult({ sessions: [session({ messages: [assistantCall('c1', 'terminal', '{not json')] })] });
    expect(run.sessions[0]!.toolCalls[0]!.args).toBe('{not json');
  });

  it('sums usage across sessions and defaults missing counters to 0', () => {
    const run = normalizeResult({
      sessions: [session({ input_tokens: 10, api_calls: 1, duration_ms: 5 }), session({ index: 1, output_tokens: 7, duration_ms: 6 })],
    });
    expect(run.totals).toMatchObject({ inputTokens: 10, outputTokens: 7, cacheReadTokens: 0, apiCalls: 1, durationMs: 11 });
  });

  it('passes through the per-session memory snapshot (null when the driver took none)', () => {
    const run = normalizeResult({
      sessions: [session(), session({ index: 1, memory_snapshot: { 'MEMORY.md': 'Client prefers WhatsApp', junk: 42 } })],
    });
    expect(run.sessions[0]!.memorySnapshot).toBeNull();
    expect(run.sessions[1]!.memorySnapshot).toEqual({ 'MEMORY.md': 'Client prefers WhatsApp' });
  });

  it('captures a driver-caught exception (harness crash)', () => {
    const run = normalizeResult({
      sessions: [{ index: 0, prompt: 'p', duration_ms: 3, exception: { type: 'ImportError', message: 'no anthropic', traceback: '…' } }],
    });
    expect(run.sessions[0]).toMatchObject({
      finalResponse: null,
      exception: { type: 'ImportError', message: 'no anthropic' },
      outcome: { completed: false },
    });
  });

  it.each([null, 'text', {}, { sessions: 'nope' }])('rejects output that is not a driver result: %j', (bad) => {
    expect(() => normalizeResult(bad)).toThrow(TraceFormatError);
  });
});
