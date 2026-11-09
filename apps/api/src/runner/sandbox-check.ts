import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Makes sure the docker sandbox can actually start before any run is claimed.
 * Without this, a stopped Docker daemon would turn every run into an
 * infra_error (retried, then excluded): an experiment that "completes" with
 * no evidence. Pulls the image once so the first runs don't time out on it.
 */
export async function ensureDockerSandbox(image: string, log: (m: string) => void): Promise<void> {
  try {
    await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 });
  } catch {
    throw new Error('Docker is not reachable (is Docker Desktop / colima running?). Start it, or set SANDBOX=local to run agent tools on this machine unsandboxed.');
  }
  try {
    await run('docker', ['image', 'inspect', image], { timeout: 15_000 });
  } catch {
    log(`Pulling sandbox image ${image} (first run only)…`);
    await run('docker', ['pull', image], { timeout: 600_000 });
  }
}
