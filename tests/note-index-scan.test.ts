import { describe, expect, it } from 'vitest';
import { scanNoteRoots } from '../src/note-index-scan';
import { MAX_INDEX_FILE_BYTES, NoteIndex } from '../src/note-index';
import type { WorkspaceDirectory } from '../src/workspace';

type Handle = { kind: 'file' | 'directory'; name: string; [key: string]: unknown };
const file = (name: string, text = ''): Handle => ({ kind: 'file', name, getFile: async () => new File([text], name) });
const directory = (name: string, entries: Handle[], broken = false): Handle => ({ kind: 'directory', name, values: async function* () {
  if (broken) throw new Error('Permission denied');
  yield* entries;
} });
const root = (name: string, entries: Handle[]): WorkspaceDirectory => ({ kind: 'browser', type: 'directory', name, rootName: name, relative: '', handle: directory(name, entries) } as unknown as WorkspaceDirectory);

describe('bounded note snapshots', () => {
  it('reports unreadable, oversized, excluded and untraversable paths', async () => {
    const bad = { kind: 'file', name: 'broken.md', getFile: async () => { throw new Error('Read blocked'); } } as Handle;
    const result = await scanNoteRoots([root('vault', [file('ok.md', '#hello'), bad, file('big.md', 'x'.repeat(MAX_INDEX_FILE_BYTES + 1)), directory('private', [], true), directory('node_modules', [])])]);
    expect(result.files.map((item) => item.name)).toEqual(['ok.md']);
    expect(result.skipped).toBe(4);
    expect(result.issues.join(' ')).toContain('vault/broken.md: Read blocked');
    expect(result.issues.join(' ')).toContain('big.md');
    expect(result.issues.join(' ')).toContain('Permission denied');
  });

  it('bounds attempts, even when every read fails', async () => {
    let reads = 0;
    const entries = Array.from({ length: 1001 }, (_, i) => ({ kind: 'file', name: `${i}.md`, getFile: async () => { reads++; throw new Error('denied'); } } as Handle));
    const result = await scanNoteRoots([root('vault', entries)]);
    expect(reads).toBe(1000); expect(result.skipped).toBe(1000); expect(result.truncated).toBe(true); expect(result.issues).toHaveLength(8);
  });

  it('reports indistinguishable root names instead of conflating them', async () => {
    const result = await scanNoteRoots([root('vault', [file('a.md')]), root('VAULT', [file('b.md')])]);
    expect(result.files.map((item) => item.name)).toEqual(['a.md']);
    expect(result.issues.join(' ')).toContain('same name');
  });

  it('discards an in-flight read after cancellation', async () => {
    const controller = new AbortController();
    const held = { kind: 'file', name: 'a.md', getFile: async () => { controller.abort(); return new File(['text'], 'a.md'); } } as Handle;
    const result = await scanNoteRoots([root('vault', [held, file('b.md')])], controller.signal);
    expect(result.files).toEqual([]);
  });

  it('merges known-good records without conflating case-sensitive paths', () => {
    const old = new NoteIndex(); const fresh = new NoteIndex();
    old.set({ name: 'A.md', relative: 'A.md', rootName: 'vault' }, '#old');
    old.set({ name: 'a.md', relative: 'a.md', rootName: 'vault' }, '#lower');
    fresh.set({ name: 'b.md', relative: 'b.md', rootName: 'vault' }, '#new');
    old.mergeFrom(fresh);
    expect(old.size).toBe(3);
    expect(old.tagIndex().map((x) => x.tag).sort()).toEqual(['lower', 'new', 'old']);
  });

  it('counts a unique cross-root link as incoming to the target root', () => {
    const index = new NoteIndex();
    index.set({ name: 'a.md', relative: 'a.md', rootName: 'one' }, '[[b]]');
    index.set({ name: 'b.md', relative: 'b.md', rootName: 'two' }, '');
    expect(index.orphans().map((record) => record.name)).toEqual(['a.md']);
  });
});
