import { spawn, type ChildProcess } from 'node:child_process';

export interface DriverExit {
  exitCode: number | null;
  timedOut: boolean;
  /** Tail of the driver's stdout+stderr, for logs and infra-error messages. */
  logTail: string;
}

/**
 * Run the Python driver with a hard wall-clock limit.
 *
 * The driver runs in its own process group (detached) so a kill also reaches
 * whatever the agent spawned through its terminal tool; killing only the
 * Python process would leave those running. SIGTERM first, SIGKILL after a
 * grace period.
 */
export function spawnDriver(opts: {
  python: string;
  driverPath: string;
  specPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Lets the caller kill it on shutdown. */
  onSpawn?: (child: ChildProcess) => void;
}): Promise<DriverExit> {
  return new Promise((resolvePromise) => {
    const child = spawn(opts.python, [opts.driverPath, opts.specPath], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    opts.onSpawn?.(child);

    let tail = '';
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-16_000);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);

    let timedOut = false;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal); // negative pid = whole process group
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 5_000).unref();
    }, opts.timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: null, timedOut, logTail: `${tail}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, timedOut, logTail: tail });
    });
  });
}

/** Kill a driver and everything it spawned (used on shutdown). */
export function killDriver(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}
