import { describe, expect, it, vi } from 'vitest';
import { CoalescingQueue, resolveSavedNote } from '../src/note-index-update';
import type { FileRef } from '../src/platform';
import type { WorkspaceDirectory } from '../src/workspace';

const nativeRoot = (name: string, path: string): WorkspaceDirectory => ({ kind: 'native', type: 'directory', name, path, relative: '' });
const native = (path: string): FileRef => ({ kind: 'native', path });
function browserRoot(name: string, resolve?: (handle: FileSystemHandle) => Promise<string[] | null>): WorkspaceDirectory {
  return { kind: 'browser', type: 'directory', name, rootName: name, relative: '', handle: { resolve } } as unknown as WorkspaceDirectory;
}
const browser = { kind: 'browser', handle: { name: 'a.md' } as FileSystemFileHandle } as const;
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('saved note containment', () => {
  it('matches native path boundaries, Windows case folding and nested roots', async () => {
    const targets = await resolveSavedNote([nativeRoot('vault', 'C:\\Vault'), nativeRoot('nested', 'C:\\Vault\\Notes')], native('c:\\vault\\Notes\\A.md'));
    expect(targets.map(({ rootName, file }) => [rootName, file.relative])).toEqual([['vault', 'Notes/A.md'], ['nested', 'A.md']]);
    expect(await resolveSavedNote([nativeRoot('vault', 'C:\\Vault')], native('C:\\Vault-other\\A.md'))).toEqual([]);
    expect(await resolveSavedNote([nativeRoot('root', '/')], native('/A.md'))).toHaveLength(1);
    expect(await resolveSavedNote([nativeRoot('posix', '/Vault')], native('/vault/A.md'))).toEqual([]);
  });
  it('uses browser handle resolution and rejects unknown or ambiguous roots', async () => {
    const roots = [browserRoot('vault', async (handle) => handle === browser.handle ? ['sub', 'a.md'] : null)];
    expect((await resolveSavedNote(roots, browser))[0].file.relative).toBe('sub/a.md');
    await expect(resolveSavedNote([browserRoot('vault')], browser)).rejects.toThrow(/verify/);
    await expect(resolveSavedNote([browserRoot('vault', async () => null), browserRoot('VAULT', async () => null)], browser)).rejects.toThrow(/indistinguishable/);
    await expect(resolveSavedNote([browserRoot('vault', async () => ['..', 'a.md'])], browser)).rejects.toThrow(/Invalid/);
  });
});

describe('bounded coalescing queue', () => {
  it('coalesces bursts and processes different files serially', async () => {
    const seen: string[] = [];
    const gate = deferred();
    const queue = new CoalescingQueue<string, string>(async (_key, value, current) => { if (value === 'latest') await gate.promise; if (current()) seen.push(value); }, () => {}, 0);
    queue.enqueue('a', 'old'); queue.enqueue('a', 'latest'); queue.enqueue('b', 'other');
    await wait(); expect(seen).toEqual([]);
    gate.release(); await wait();
    expect(seen).toEqual(['latest', 'other']); expect(queue.busy).toBe(false);
  });
  it('discards superseded reads and processes only the newest revision', async () => {
    const seen: string[] = []; const gate = deferred();
    const queue = new CoalescingQueue<string, string>(async (_key, value, current) => { if (value === 'old') await gate.promise; if (current()) seen.push(value); }, () => {}, 0);
    queue.enqueue('a', 'old'); await wait(); queue.enqueue('a', 'new'); gate.release(); await wait();
    expect(seen).toEqual(['new']);
  });
  it('invalidates in-flight work on cancel and permits a new generation', async () => {
    const seen: string[] = []; const gate = deferred();
    const queue = new CoalescingQueue<string, string>(async (_key, value, current) => { if (value === 'old') await gate.promise; if (current()) seen.push(value); }, () => {}, 0);
    queue.enqueue('a', 'old'); await wait(); queue.cancel(); queue.enqueue('a', 'new'); await wait();
    expect(seen).toEqual(['new']); gate.release(); await wait(); expect(seen).toEqual(['new']);
  });
  it('rejects overflow while allowing an existing key to coalesce', () => {
    vi.useFakeTimers();
    try {
      const queue = new CoalescingQueue<string, string>(async () => {}, () => {}, 100, 1);
      expect(queue.enqueue('a', 'first')).toBe(true); expect(queue.enqueue('a', 'latest')).toBe(true);
      expect(queue.enqueue('b', 'other')).toBe(false); queue.cancel(); expect(queue.busy).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
