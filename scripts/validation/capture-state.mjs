#!/usr/bin/env node
// VAL-02 evidence helper. Records the state of a directory tree before and after a matrix case,
// so each case can show that no unexpected file was created, changed or removed.
//
//   node scripts/validation/capture-state.mjs snapshot <dir> <out.json>
//   node scripts/validation/capture-state.mjs diff <before.json> <after.json>
//
// Recognized symlinks and junctions are recorded by their target text, not traversed.
// This is not a security boundary: other reparse points and concurrent path swaps may be followed.
// Run only on quiescent, disposable synthetic trees; capture outside targets separately.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Build a sorted snapshot of a quiescent synthetic tree, without following recognized links. */
/** @param {string} root */
export async function snapshot(root) {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error('Snapshot root must be a real directory, not a link.');
  }
  /** @type {Record<string, unknown>[]} */
  const entries = [];
  /** @param {string} dir */
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
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(full)) hash.update(chunk);
        const after = await lstat(full);
        if (!after.isFile() || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino) {
          throw new Error(`File changed during snapshot: ${rel}`);
        }
        entries.push({
          path: rel, type: 'file', size: info.size, mtimeMs: info.mtimeMs,
          readOnly: (info.mode & 0o222) === 0,
          sha256: hash.digest('hex'),
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
/** @param {{ entries: Record<string, any>[] }} before @param {{ entries: Record<string, any>[] }} after */
export function diffSnapshots(before, after) {
  /** @param {Record<string, any>} e */
  const key = (e) => e.path;
  const a = new Map(before.entries.map((/** @type {Record<string, any>} */ e) => [key(e), e]));
  const b = new Map(after.entries.map((/** @type {Record<string, any>} */ e) => [key(e), e]));
  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const removed = [];
  /** @type {{ path: string, fields: string[] }[]} */
  const changed = [];
  for (const [path, entry] of b) {
    if (!a.has(path)) added.push(path);
    else {
      const old = a.get(path);
      const fields = ['type', 'size', 'sha256', 'target', 'readOnly', 'mtimeMs'].filter((/** @type {string} */ f) => old[f] !== entry[f]);
      if (fields.length) changed.push({ path, fields });
    }
  }
  for (const path of a.keys()) if (!b.has(path)) removed.push(path);
  return { added, removed, changed, identical: !added.length && !removed.length && !changed.length };
}

/** @param {string[]} argv */
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
