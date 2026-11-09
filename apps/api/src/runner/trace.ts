/**
 * Turns runner/driver.py's raw JSON into our own shape, so graders, the DB
 * and the UI never depend on Hermes's message format directly.
 */
import type { SessionView } from '../grading/graders';

export interface NormalizedToolCall {
  /** Hermes/OpenAI tool_call_id; null if the model omitted it. */
  id: string | null;
  name: string;
  /** Parsed JSON arguments; the raw string if they weren't valid JSON. */
  args: unknown;
  /** Tool output text; null if no result message came back for this call. */
  result: string | null;
}

export interface NormalizedSession {
  idx: number;
  prompt: string;
  finalResponse: string | null;
  toolCalls: NormalizedToolCall[];
  /** Raw transcript, kept verbatim for the trace viewer. */
  messages: unknown[];
  availableTools: string[];
  /** MEMORY.md / USER.md after this session (driver snapshot); null if none was taken. */
  memorySnapshot: Record<string, string> | null;
  outcome: {
    completed: boolean;
    failed: boolean;
    partial: boolean;
    error: string | null;
    failureReason: string | null;
    failureRetryable: boolean | null;
    turnExitReason: string | null;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    apiCalls: number;
  };
  durationMs: number;
  /** Set when the driver caught a Python exception (a harness crash, not agent behaviour). */
  exception: { type: string; message: string } | null;
}

export interface NormalizedRun {
  sessions: NormalizedSession[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    apiCalls: number;
    toolCalls: number;
    durationMs: number;
  };
}

/** Thrown when the driver output isn't even structurally a result (→ infra_error). */
export class TraceFormatError extends Error {}

/**
 * Lenient about fields (missing counters → 0, missing text → null: Hermes
 * omits keys freely), strict about structure (not a {sessions: [...]} object
 * → TraceFormatError, which the runner treats as an infra error).
 */
export function normalizeResult(raw: unknown): NormalizedRun {
  if (!isRecord(raw) || !Array.isArray(raw.sessions)) {
    throw new TraceFormatError('driver output is not a {sessions: [...]} object');
  }
  const sessions = raw.sessions.map((s, i) => {
    if (!isRecord(s)) throw new TraceFormatError(`session ${i} is not an object`);
    return normalizeSession(s, i);
  });

  const sum = (pick: (s: NormalizedSession) => number) => sessions.reduce((acc, s) => acc + pick(s), 0);
  return {
    sessions,
    totals: {
      inputTokens: sum((s) => s.usage.inputTokens),
      outputTokens: sum((s) => s.usage.outputTokens),
      cacheReadTokens: sum((s) => s.usage.cacheReadTokens),
      cacheWriteTokens: sum((s) => s.usage.cacheWriteTokens),
      apiCalls: sum((s) => s.usage.apiCalls),
      toolCalls: sum((s) => s.toolCalls.length),
      durationMs: sum((s) => s.durationMs),
    },
  };
}

/** What graders see of each session. */
export function toSessionViews(run: NormalizedRun): SessionView[] {
  return run.sessions.map((s) => ({
    finalResponse: s.finalResponse,
    toolCalls: s.toolCalls.map(({ name, args }) => ({ name, args })),
  }));
}

function normalizeSession(s: Record<string, unknown>, i: number): NormalizedSession {
  const messages = Array.isArray(s.messages) ? s.messages : [];

  // Tool results reference their call by tool_call_id (OpenAI message format).
  const results = new Map<string, string>();
  for (const m of messages) {
    if (isRecord(m) && m.role === 'tool' && typeof m.tool_call_id === 'string') {
      results.set(m.tool_call_id, typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
    }
  }

  const toolCalls: NormalizedToolCall[] = [];
  for (const m of messages) {
    if (!isRecord(m) || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      if (!isRecord(tc)) continue;
      const fn = isRecord(tc.function) ? tc.function : {};
      const id = str(tc.id) ?? str(tc.call_id);
      toolCalls.push({
        id,
        name: str(fn.name) ?? str(tc.name) ?? 'unknown',
        args: parseArgs(fn.arguments),
        result: id ? (results.get(id) ?? null) : null,
      });
    }
  }

  const exception = isRecord(s.exception)
    ? { type: str(s.exception.type) ?? 'Exception', message: str(s.exception.message) ?? '' }
    : null;

  return {
    idx: num(s.index, i),
    prompt: str(s.prompt) ?? '',
    finalResponse: str(s.final_response),
    toolCalls,
    messages,
    availableTools: Array.isArray(s.available_tools) ? s.available_tools.filter((t): t is string => typeof t === 'string') : [],
    memorySnapshot: isRecord(s.memory_snapshot)
      ? Object.fromEntries(Object.entries(s.memory_snapshot).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : null,
    outcome: {
      completed: s.completed === true,
      failed: s.failed === true,
      partial: s.partial === true,
      error: str(s.error),
      failureReason: str(s.failure_reason),
      failureRetryable: typeof s.failure_retryable === 'boolean' ? s.failure_retryable : null,
      turnExitReason: str(s.turn_exit_reason),
    },
    usage: {
      inputTokens: num(s.input_tokens),
      outputTokens: num(s.output_tokens),
      cacheReadTokens: num(s.cache_read_tokens),
      cacheWriteTokens: num(s.cache_write_tokens),
      apiCalls: num(s.api_calls),
    },
    durationMs: num(s.duration_ms),
    exception,
  };
}

/** Tool arguments arrive as a JSON string; keep the raw string if the model emitted broken JSON. */
function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
