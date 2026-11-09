/**
 * Parses hand-written suite and config YAML into validated snapshots.
 *
 * Pure: file reading is injected, so tests don't touch disk. Everything is
 * strict (unknown keys are errors) and every error names the file and the
 * exact field, because a typo here would silently change WHAT is tested.
 */
import type { AgentConfigSnapshot, TaskSnapshot } from '@agent-evals/shared';

export class CatalogError extends Error {}

export interface ParsedSuite {
  slug: string;
  name: string;
  description: string;
  version: number;
  tasks: TaskSnapshot[];
}

export type ParsedConfig = AgentConfigSnapshot & { description: string };

export function parseSuiteFile(
  _text: string,
  _opts: {
    fileName: string;
    /** Reads a fixture file relative to the suite file; null if missing. */
    readFixture: (relPath: string) => string | null;
  },
): ParsedSuite {
  throw new Error('not implemented');
}

export function parseConfigFile(_text: string, _opts: { fileName: string }): ParsedConfig {
  throw new Error('not implemented');
}
