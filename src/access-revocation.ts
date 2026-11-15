// AUD-03: revocable folder access. These wrappers call the native commands that record a revoked
// folder and refuse native reads, writes and listings under it. Revoking a folder that an open
// document still uses must be deferred by the caller until the document closes.
import { invoke } from '@tauri-apps/api/core';

export const ACCESS_REVOKED = 'ACCESS_REVOKED';

/** Revoke a folder's access. Refused for paths that are relative or contain “..”. */
export function revokeFolderAccess(path: string): Promise<void> {
  return invoke<void>('access_revoke', { path });
}

/** Restore a folder's access after the user reopens it. */
export function restoreFolderAccess(path: string): Promise<void> {
  return invoke<void>('access_restore', { path });
}

/** Folders whose access is currently revoked. */
export function listRevokedFolders(): Promise<string[]> {
  return invoke<string[]>('access_revoked_list');
}

/** True when a native error means access was refused because the folder was revoked. */
export function isAccessRevokedError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.startsWith(ACCESS_REVOKED);
}
