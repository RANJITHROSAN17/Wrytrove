import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffSnapshots, snapshot } from '../scripts/validation/capture-state.mjs';

let root: string;
let outside: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'val02-scope-'));
  outside = await mkdtemp(join(tmpdir(), 'val02-outside-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('VAL-02 state capture', () => {
  it('reports identical snapshots when nothing changed', async () => {
    await writeFile(join(root, 'note.txt'), 'synthetic');
    const a = await snapshot(root);
    const b = await snapshot(root);
    expect(diffSnapshots(a, b).identical).toBe(true);
  });

  it('detects a changed file, an added file and a removed file', async () => {
    await writeFile(join(root, 'a.txt'), 'one');
    await writeFile(join(root, 'b.txt'), 'two');
    const before = await snapshot(root);
    await writeFile(join(root, 'a.txt'), 'changed');
    await writeFile(join(root, 'c.txt'), 'new');
    await rm(join(root, 'b.txt'));
    const diff = diffSnapshots(before, await snapshot(root));
    expect(diff.added).toEqual(['c.txt']);
    expect(diff.removed).toEqual(['b.txt']);
    expect(diff.changed).toEqual([{ path: 'a.txt', fields: expect.arrayContaining(['sha256', 'size']) }]);
  });

  it('detects a same-size edit through the hash', async () => {
    await writeFile(join(root, 'x.txt'), 'AAAA');
    const before = await snapshot(root);
    await writeFile(join(root, 'x.txt'), 'BBBB');
    await utimes(join(root, 'x.txt'), new Date(0), new Date(0));
    const diff = diffSnapshots(before, await snapshot(root));
    expect(diff.changed[0].fields).toContain('sha256');
  });

  it('records a symlink by its target and never reads the outside file', async () => {
    const secret = join(outside, 'secret.txt');
    await writeFile(secret, 'outside content');
    await symlink(secret, join(root, 'link.txt'));
    const snap = await snapshot(root);
    const link = snap.entries.find((e) => e.path === 'link.txt');
    expect(link).toEqual({ path: 'link.txt', type: 'symlink', target: secret });
    expect(snap.entries.some((e) => e.path.includes('secret'))).toBe(false);
  });

  it('flags a link whose target changed even though the link path is the same', async () => {
    const first = join(outside, 'one.txt');
    const second = join(outside, 'two.txt');
    await writeFile(first, '1'); await writeFile(second, '2');
    await symlink(first, join(root, 'l'));
    const before = await snapshot(root);
    await rm(join(root, 'l'));
    await symlink(second, join(root, 'l'));
    const diff = diffSnapshots(before, await snapshot(root));
    expect(diff.changed).toEqual([{ path: 'l', fields: ['target'] }]);
  });

  it('keeps nested paths with forward slashes', async () => {
    await mkdir(join(root, 'sub', 'deep'), { recursive: true });
    await writeFile(join(root, 'sub', 'deep', 'f.md'), '# hi');
    const snap = await snapshot(root);
    expect(snap.entries.map((e) => e.path)).toContain('sub/deep/f.md');
  });

  it('round-trips through JSON as the CLI writes it', async () => {
    await writeFile(join(root, 'j.txt'), 'json');
    const snap = await snapshot(root);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(await readFile(join(root, 'j.txt'), 'utf8')).toBe('json');
  });
});
