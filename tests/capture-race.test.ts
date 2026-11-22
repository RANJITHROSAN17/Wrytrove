import { describe, expect, it, vi } from 'vitest';
import { Workbench } from '../src/workbench';
import type { WorkspaceDirectory } from '../src/workspace';

type FakeHandle = { kind: 'file' | 'directory'; name: string; [key: string]: unknown };

function fixture(options: { initial?: string; appearAfterFirstLookup?: string; changeOnRecheck?: string; collideOnCreate?: string } = {}) {
  let text = options.initial;
  let listings = 0, reads = 0, writes = 0, creates = 0;
  const file: FakeHandle = {
    kind: 'file', name: 'Inbox.md',
    getFile: async () => {
      reads++;
      if (reads === 2 && options.changeOnRecheck !== undefined) text = options.changeOnRecheck;
      return new File([text ?? ''], 'Inbox.md');
    },
    createWritable: async () => {
      let next = '';
      return {
        write: async (bytes: Uint8Array) => { next = new TextDecoder().decode(bytes); },
        close: async () => { text = next; writes++; },
        abort: async () => {},
      };
    },
  };
  const directory: FakeHandle = {
    kind: 'directory', name: 'project',
    values: async function* () {
      listings++;
      if (text !== undefined) yield file;
      // Simulate another writer creating the file after the first enumeration.
      if (listings === 1 && options.appearAfterFirstLookup !== undefined) text = options.appearAfterFirstLookup;
    },
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (name !== 'Inbox.md') throw new DOMException('Missing', 'NotFoundError');
      if (options.collideOnCreate !== undefined && text === undefined) text = options.collideOnCreate;
      if (text !== undefined) return file;
      if (!opts?.create) throw new DOMException('Missing', 'NotFoundError');
      text = ''; creates++;
      return file;
    },
    getDirectoryHandle: async () => { throw new DOMException('Missing', 'NotFoundError'); },
  };
  const folder = { kind: 'browser', type: 'directory', name: 'project', relative: '', handle: directory } as unknown as WorkspaceDirectory;
  // Only the folder-note methods are under test. The constructor binds the full UI,
  // so instantiate the prototype with its workspace state and a stub tree refresh.
  const workbench = Object.assign(Object.create(Workbench.prototype), {
    roots: [{ id: 1, folder, listings: new Map(), expanded: new Set(), rootExpanded: true }],
    refreshRoot: vi.fn(),
  }) as Workbench;
  return { workbench, get text() { return text; }, get writes() { return writes; }, get creates() { return creates; }, get listings() { return listings; } };
}

describe('folder capture creation race', () => {
  it('appends exactly once if the note appears between the two lookups', async () => {
    const f = fixture({ appearAfterFirstLookup: 'Other writer content' });
    const result = await f.workbench.appendToNote(null, 'Inbox.md', 'Captured text', 'Header');
    expect(result.created).toBe(false);
    expect(f.listings).toBe(2);
    expect(f.text).toBe('Other writer content\n\nHeader\nCaptured text\n');
    expect(f.writes).toBe(1);
    expect(f.creates).toBe(0);
  });

  it('still creates a missing note and appends to a note found immediately', async () => {
    const missing = fixture();
    expect((await missing.workbench.appendToNote(null, 'Inbox.md', 'New', 'Header')).created).toBe(true);
    expect(missing.text).toBe('Header\nNew\n');
    expect(missing.writes).toBe(1);
    expect(missing.creates).toBe(1);
    const existing = fixture({ initial: 'Existing\n' });
    expect((await existing.workbench.appendToNote(null, 'Inbox.md', 'Next')).created).toBe(false);
    expect(existing.text).toBe('Existing\n\nNext\n');
    expect(existing.writes).toBe(1);
  });

  it('does not overwrite a raced-in file changed before the checked write', async () => {
    const f = fixture({ appearAfterFirstLookup: 'Initial content', changeOnRecheck: 'External edit' });
    await expect(f.workbench.appendToNote(null, 'Inbox.md', 'Capture')).rejects.toThrow('changed on disk');
    expect(f.text).toBe('External edit');
    expect(f.writes).toBe(0);
  });

  it('does not claim success or overwrite when a file appears at creation', async () => {
    const f = fixture({ collideOnCreate: 'Created by another writer' });
    await expect(f.workbench.appendToNote(null, 'Inbox.md', 'Capture')).rejects.toThrow('already exists');
    expect(f.text).toBe('Created by another writer');
    expect(f.writes).toBe(0);
  });
});
