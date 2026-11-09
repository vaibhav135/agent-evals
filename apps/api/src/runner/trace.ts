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

export function normalizeResult(_raw: unknown): NormalizedRun {
  throw new Error('not implemented');
}

/** What graders see of each session. */
export function toSessionViews(_run: NormalizedRun): SessionView[] {
  throw new Error('not implemented');
}
