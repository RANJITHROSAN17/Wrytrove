export interface SnapshotEntry {
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size?: number;
  mtimeMs?: number;
  readOnly?: boolean;
  sha256?: string;
  target?: string;
}
export interface Snapshot {
  version: 1;
  root: string;
  entries: SnapshotEntry[];
}
export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: { path: string; fields: string[] }[];
  identical: boolean;
}
export function snapshot(root: string): Promise<Snapshot>;
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff;
