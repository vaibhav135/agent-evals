import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeWorkspaceReader } from './workspace-reader';

describe('makeWorkspaceReader', () => {
  let base: string;
  let read: (p: string) => string | null;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'ws-reader-'));
    mkdirSync(join(base, 'ws', 'out'), { recursive: true });
    writeFileSync(join(base, 'ws', 'out', 'scored.json'), '{"ok":true}');
    writeFileSync(join(base, 'secret.txt'), 'outside the workspace');
    writeFileSync(join(base, 'ws', 'big.txt'), 'x'.repeat(50));
    symlinkSync(join(base, 'secret.txt'), join(base, 'ws', 'sneaky.txt')); // agent-made symlink pointing out
    symlinkSync(join(base, 'ws', 'out', 'scored.json'), join(base, 'ws', 'alias.json')); // symlink staying inside
    read = makeWorkspaceReader(join(base, 'ws'), 20);
  });

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('reads files inside the workspace, including nested ones', () => {
    expect(read('out/scored.json')).toBe('{"ok":true}');
  });

  it('returns null for files that do not exist', () => {
    expect(read('out/missing.json')).toBeNull();
  });

  it('refuses ../ paths and absolute paths', () => {
    expect(read('../secret.txt')).toBeNull();
    expect(read(join(base, 'secret.txt'))).toBeNull();
  });

  it('refuses a symlink that points outside the workspace', () => {
    expect(read('sneaky.txt')).toBeNull();
  });

  it('follows a symlink that stays inside the workspace', () => {
    expect(read('alias.json')).toBe('{"ok":true}');
  });

  it('refuses directories', () => {
    expect(read('out')).toBeNull();
  });

  it('caps oversized files', () => {
    expect(read('big.txt')).toBe('x'.repeat(20));
  });
});
