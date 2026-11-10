/**
 * Typed calls to the Nest API. Response types come from @agent-evals/shared,
 * the same package the API is typed against, so a contract change breaks the
 * web typecheck instead of rendering undefined.
 */
import type {
  ConfigSummary, CreateExperimentRequest, ExperimentAnalysis, ExperimentSummary,
  RunDetail, RunSummary, SuiteSummary,
} from '@agent-evals/shared';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    // The API's error body is { statusCode, error, message, issues? }.
    const body = await res.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
    throw new ApiError(res.status, message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  suites: () => request<SuiteSummary[]>('/suites'),
  configs: () => request<ConfigSummary[]>('/configs'),
  experiments: () => request<ExperimentSummary[]>('/experiments'),
  experiment: (id: string) => request<ExperimentSummary>(`/experiments/${id}`),
  analysis: (id: string) => request<ExperimentAnalysis>(`/experiments/${id}/analysis`),
  runs: (id: string, filter: { task?: string; arm?: 'A' | 'B' } = {}) => {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
    return request<RunSummary[]>(`/experiments/${id}/runs${q.size ? `?${q}` : ''}`);
  },
  run: (id: string) => request<RunDetail>(`/runs/${id}`),
  create: (body: CreateExperimentRequest) =>
    request<ExperimentSummary>('/experiments', { method: 'POST', body: JSON.stringify(body) }),
  start: (id: string) => request<ExperimentSummary>(`/experiments/${id}/start`, { method: 'POST' }),
  cancel: (id: string) => request<ExperimentSummary>(`/experiments/${id}/cancel`, { method: 'POST' }),
};

/** Poll while work is in flight; stop once nothing can change. */
export const pollWhileActive = (status: string | undefined) =>
  status === 'running' || status === 'pending' ? 3000 : false;
