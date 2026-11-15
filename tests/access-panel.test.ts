import { describe, expect, it } from 'vitest';
import { buildAccessRows, folderName, pathInside, type PanelFolder } from '../src/access-panel';

const notes: PanelFolder = { path: '/home/me/Notes', name: 'Notes', openDocuments: 0, inWorkspace: false };

describe('access panel rows', () => {
  it('offers revoke for a closed folder with no open documents', () => {
    expect(buildAccessRows([notes], [])).toEqual([{ path: '/home/me/Notes', name: 'Notes', state: 'active', action: 'revoke' }]);
  });

  it('blocks revoke while the folder is an open workspace root', () => {
    const [row] = buildAccessRows([{ ...notes, inWorkspace: true }], []);
    expect(row).toMatchObject({ action: 'blocked' });
    expect(row.action === 'blocked' && row.reason).toMatch(/Close this folder in the workspace/u);
  });

  it('blocks revoke while documents from the folder are open, and counts them', () => {
    const [one] = buildAccessRows([{ ...notes, openDocuments: 1 }], []);
    const [two] = buildAccessRows([{ ...notes, openDocuments: 2 }], []);
    expect(one.action === 'blocked' && one.reason).toBe('Close the 1 open document from this folder before revoking access.');
    expect(two.action === 'blocked' && two.reason).toBe('Close the 2 open documents from this folder before revoking access.');
  });

  it('shows revoked folders with restore, and never shows a revoked folder as active', () => {
    const rows = buildAccessRows([notes], ['/home/me/Notes']);
    expect(rows).toEqual([{ path: '/home/me/Notes', name: 'Notes', state: 'revoked', action: 'restore' }]);
  });

  it('lists revoked folders that are not currently open', () => {
    const rows = buildAccessRows([], ['C:\\Users\\me\\Old']);
    expect(rows).toEqual([{ path: 'C:\\Users\\me\\Old', name: 'Old', state: 'revoked', action: 'restore' }]);
  });

  it('treats paths that differ only by case or trailing separator as one folder', () => {
    const rows = buildAccessRows([{ ...notes, path: '/HOME/me/notes/' }], ['/home/me/Notes']);
    expect(rows.map((row) => row.state)).toEqual(['revoked']);
  });
});

describe('path helpers', () => {
  it('matches only on a separator boundary', () => {
    expect(pathInside('/a/foo', '/a/foo/x.md')).toBe(true);
    expect(pathInside('/a/foo', '/a/foobar/x.md')).toBe(false);
    expect(pathInside('C:\\Notes', 'c:/notes/sub/a.md')).toBe(true);
  });

  it('takes the last path segment as the folder name', () => {
    expect(folderName('C:\\Users\\me\\Docs\\')).toBe('Docs');
    expect(folderName('/tmp/x')).toBe('x');
  });
});
