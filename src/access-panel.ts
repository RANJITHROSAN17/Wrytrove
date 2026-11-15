// AUD-03: plans the rows of the Access leases panel. Pure, so the rules can be tested without the DOM.
//
// Revoking is allowed only when a folder is closed in the workspace and no open document comes from
// it. A revocation is never deferred or hidden: the user sees the blocker and what to close first.
// Restoring a revoked folder only clears the native record; the user must still choose the folder
// again before Wrytrove can read it.

export interface PanelFolder {
  path: string;
  name: string;
  /** Open documents whose file lies inside this folder. */
  openDocuments: number;
  /** The folder is an open workspace root. */
  inWorkspace: boolean;
}

export type AccessRow =
  | { path: string; name: string; state: 'active'; action: 'revoke' }
  | { path: string; name: string; state: 'active'; action: 'blocked'; reason: string }
  | { path: string; name: string; state: 'revoked'; action: 'restore' };

/** Last path segment, for display. Handles both separator styles. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/u).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/** Comparable form of a path: forward slashes, no trailing separator, lower-cased. */
export function comparablePath(path: string): string {
  return path.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase();
}

/** True when `path` is `root` or inside it, on a separator boundary. */
export function pathInside(root: string, path: string): boolean {
  const r = comparablePath(root);
  const p = comparablePath(path);
  return p === r || p.startsWith(`${r}/`);
}

/** Rows for the panel. A folder that appears in the revoked record is shown only as revoked. */
export function buildAccessRows(folders: PanelFolder[], revoked: string[]): AccessRow[] {
  const revokedKeys = new Set(revoked.map(comparablePath));
  const rows: AccessRow[] = [];
  const seen = new Set<string>();
  for (const folder of folders) {
    const key = comparablePath(folder.path);
    if (seen.has(key) || revokedKeys.has(key)) continue;
    seen.add(key);
    if (folder.inWorkspace) {
      rows.push({ path: folder.path, name: folder.name, state: 'active', action: 'blocked', reason: 'Close this folder in the workspace before revoking access.' });
    } else if (folder.openDocuments > 0) {
      const count = folder.openDocuments;
      rows.push({ path: folder.path, name: folder.name, state: 'active', action: 'blocked', reason: `Close the ${count} open ${count === 1 ? 'document' : 'documents'} from this folder before revoking access.` });
    } else {
      rows.push({ path: folder.path, name: folder.name, state: 'active', action: 'revoke' });
    }
  }
  for (const path of revoked) {
    const key = comparablePath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ path, name: folderName(path), state: 'revoked', action: 'restore' });
  }
  return rows;
}
