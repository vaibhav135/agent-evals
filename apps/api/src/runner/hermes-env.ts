import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** runner/.hermes-env.json, written by runner/setup-hermes.sh. */
export const HermesEnv = z.object({
  hermesCommit: z.string(),
  python: z.string(),
  pythonPath: z.string(),
  pathPrefix: z.array(z.string()),
  runtimeDir: z.string(),
  playwrightBrowsersPath: z.string(),
});
export type HermesEnv = z.infer<typeof HermesEnv>;

export function loadHermesEnv(file: string): HermesEnv {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`Hermes is not set up: ${file} not found. Run ./runner/setup-hermes.sh first.`);
  }
  return HermesEnv.parse(JSON.parse(raw));
}

/**
 * Environment for one driver process. Built from scratch (not inherited) so
 * nothing from the API's own environment leaks into the agent, e.g. other
 * provider keys that Hermes's provider auto-detection might pick up.
 */
export function driverEnv(h: HermesEnv, opts: { hermesHome: string; workspace: string; anthropicApiKey: string }): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    PATH: [...h.pathPrefix, '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    PYTHONPATH: h.pythonPath,
    HERMES_RUNTIME_DIR: h.runtimeDir,
    PLAYWRIGHT_BROWSERS_PATH: h.playwrightBrowsersPath,
    HERMES_HOME: opts.hermesHome,
    TERMINAL_CWD: opts.workspace,
    ANTHROPIC_API_KEY: opts.anthropicApiKey,
  };
}
