#!/usr/bin/env node
// VAL-02 evidence helper. Records the state of a directory tree before and after a matrix case,
// so each case can show that no unexpected file was created, changed or removed.
//
//   node scripts/validation/capture-state.mjs snapshot <dir> <out.json>
//   node scripts/validation/capture-state.mjs diff <before.json> <after.json>
//
// Links are never followed: symlinks and junctions are recorded by their own target text, so a
// link pointing outside the scope shows up as a link change, not as changes to its target.
// Use only disposable VMs and synthetic content.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Build a sorted snapshot of every entry below `root`, without following links. */
export async function snapshot(root) {
  const entries = [];
  async function walk(dir) {
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      const full = join(dir, name);
      const info = await lstat(full);
      const rel = relative(root, full).split(sep).join('/');
      if (info.isSymbolicLink()) {
        entries.push({ path: rel, type: 'symlink', target: await readlink(full) });
      } else if (info.isDirectory()) {
        entries.push({ path: rel, type: 'dir', mtimeMs: info.mtimeMs });
        await walk(full);
      } else if (info.isFile()) {
        const bytes = await readFile(full);
        entries.push({
          path: rel, type: 'file', size: info.size, mtimeMs: info.mtimeMs,
          readOnly: (info.mode & 0o222) === 0,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      } else {
        entries.push({ path: rel, type: 'other' });
      }
    }
  }
  await walk(root);
  return { version: 1, root: '.', entries };
}

/** Compare two snapshots. Returns added, removed and changed entries (paths and their fields). */
export function diffSnapshots(before, after) {
  const key = (e) => e.path;
  const a = new Map(before.entries.map((e) => [key(e), e]));
  const b = new Map(after.entries.map((e) => [key(e), e]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [path, entry] of b) {
    if (!a.has(path)) added.push(path);
    else {
      const old = a.get(path);
      const fields = ['type', 'size', 'sha256', 'target', 'readOnly', 'mtimeMs'].filter((f) => old[f] !== entry[f]);
      if (fields.length) changed.push({ path, fields });
    }
  }
  for (const path of a.keys()) if (!b.has(path)) removed.push(path);
  return { added, removed, changed, identical: !added.length && !removed.length && !changed.length };
}

async function main(argv) {
  const [command, first, second] = argv;
  if (command === 'snapshot' && first && second) {
    await writeFile(second, JSON.stringify(await snapshot(first), null, 2) + '\n');
    console.log(`Wrote ${second}`);
    return 0;
  }
  if (command === 'diff' && first && second) {
    const result = diffSnapshots(JSON.parse(await readFile(first, 'utf8')), JSON.parse(await readFile(second, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    return result.identical ? 0 : 1;
  }
  console.error('usage: capture-state.mjs snapshot <dir> <out.json> | diff <before.json> <after.json>');
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(error); process.exitCode = 2; });
}
