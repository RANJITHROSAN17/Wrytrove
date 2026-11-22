import type { FileRef } from './platform';
import type { WorkspaceDirectory, WorkspaceFile } from './workspace';

export interface SavedNoteTarget { rootName: string; file: WorkspaceFile; }

/** Resolve against a snapshot of open roots. Failure to prove containment is not a match. */
export async function resolveSavedNote(roots: readonly WorkspaceDirectory[], ref: FileRef): Promise<SavedNoteTarget[]> {
  if (ref.kind === 'download') return [];
  const names = new Set<string>();
  for (const root of roots) {
    const key = root.name.toLowerCase();
    if (names.has(key)) throw new Error('Workspace roots have indistinguishable names.');
    names.add(key);
  }
  const result: SavedNoteTarget[] = [];
  for (const root of roots) {
    let relative: string | null = null;
    if (ref.kind === 'native' && root.kind === 'native') {
      const normalize = (value: string) => value.replace(/\\/gu, '/').replace(/\/+$/u, '');
      const base = normalize(root.path), path = normalize(ref.path);
      const windows = /^(?:[a-z]:\/|\/\/)/iu.test(root.path.replace(/\\/gu, '/'));
      const prefix = (base || '') + '/';
      if ((windows ? path.toLowerCase() : path).startsWith(windows ? prefix.toLowerCase() : prefix)) relative = path.slice(prefix.length);
    } else if (ref.kind === 'browser' && root.kind === 'browser') {
      if (typeof root.handle.resolve !== 'function') throw new Error('Cannot verify the saved file’s folder.');
      const parts = await root.handle.resolve(ref.handle);
      if (parts) relative = parts.join('/');
    }
    if (!relative) continue;
    const parts = relative.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || /[\\\0]/u.test(part))) throw new Error('Invalid saved file path.');
    const name = parts[parts.length - 1];
    if (ref.kind === 'native' && root.kind === 'native') result.push({ rootName: root.name, file: { kind: 'native', type: 'file', name, path: ref.path, relative } });
    else if (ref.kind === 'browser' && root.kind === 'browser') result.push({ rootName: root.name, file: { kind: 'browser', type: 'file', name, rootName: root.name, handle: ref.handle, relative } });
  }
  return result;
}

/** Single-worker bounded queue; generations prevent canceled or superseded work from committing. */
export class CoalescingQueue<K, V> {
  private pending = new Map<K, { value: V; version: number }>();
  private versions = new Map<K, number>();
  private generation = 0;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly run: (key: K, value: V, current: () => boolean) => Promise<void>,
    private readonly changed: () => void,
    private readonly delay = 300,
    private readonly limit = 100,
  ) {}
  get busy(): boolean { return this.active || this.pending.size > 0; }
  enqueue(key: K, value: V): boolean {
    if (!this.pending.has(key) && !this.versions.has(key) && this.versions.size >= this.limit) return false;
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    this.pending.set(key, { value, version });
    if (!this.active) this.schedule();
    this.changed();
    return true;
  }
  cancel(): void {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear(); this.versions.clear(); this.active = false;
    this.changed();
  }
  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, this.delay);
  }
  private async drain(): Promise<void> {
    if (this.active) return;
    const generation = this.generation;
    this.active = true;
    this.changed();
    try {
      while (generation === this.generation && this.pending.size) {
        const [key, task] = this.pending.entries().next().value!;
        this.pending.delete(key);
        const current = () => generation === this.generation && this.versions.get(key) === task.version;
        await this.run(key, task.value, current);
        if (current()) this.versions.delete(key);
      }
    } finally {
      if (generation === this.generation) {
        this.active = false;
        if (this.pending.size) this.schedule();
        this.changed();
      }
    }
  }
}
