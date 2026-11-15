import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ACCESS_REVOKED, isAccessRevokedError, listRevokedFolders, restoreFolderAccess, revokeFolderAccess } from '../src/access-revocation';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));

describe('folder access revocation client', () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); vi.mocked(invoke).mockResolvedValue(undefined); });

  it('sends revoke and restore to the native commands with the same path', async () => {
    await revokeFolderAccess('/notes/a');
    await restoreFolderAccess('/notes/a');
    expect(invoke).toHaveBeenNthCalledWith(1, 'access_revoke', { path: '/notes/a' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'access_restore', { path: '/notes/a' });
  });

  it('lists revoked folders from the native record', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['/notes/a']);
    await expect(listRevokedFolders()).resolves.toEqual(['/notes/a']);
    expect(invoke).toHaveBeenCalledWith('access_revoked_list');
  });

  it('recognises the revoked-access error from either an Error or a string', () => {
    expect(isAccessRevokedError(new Error(`${ACCESS_REVOKED}: access to this folder was revoked`))).toBe(true);
    expect(isAccessRevokedError(`${ACCESS_REVOKED}: damaged`)).toBe(true);
    expect(isAccessRevokedError(new Error('This file has not been selected for access in Wrytrove.'))).toBe(false);
  });
});
