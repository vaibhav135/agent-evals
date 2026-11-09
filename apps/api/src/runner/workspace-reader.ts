import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * A `readFile` for graders that can only see inside one run's workspace.
 *
 * Paths come from task files and the files themselves from the agent, so both
 * `../` paths and symlinks the agent created (`ln -s /etc/passwd out.txt`)
 * must not escape. The check runs on the REAL path (symlinks resolved), not
 * the requested one. Files are capped so a runaway agent can't make grading
 * load gigabytes; an oversized file is read up to the cap.
 */
export function makeWorkspaceReader(workspaceDir: string, maxBytes = 1_000_000): (path: string) => string | null {
  const root = realpathSync(workspaceDir);
  return (path: string) => {
    if (isAbsolute(path)) return null;
    let real: string;
    try {
      real = realpathSync(resolve(root, path));
    } catch {
      return null; // does not exist (or a dangling symlink)
    }
    const rel = relative(root, real);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null; // escapes the workspace
    try {
      if (!statSync(real).isFile()) return null;
      const buf = readFileSync(real);
      return buf.subarray(0, maxBytes).toString('utf8');
    } catch {
      return null;
    }
  };
}
