/**
 * save-conflict — the policy behind "this file changed on disk".
 *
 * Saving is the one operation where a wrong decision loses a file, so the decision rules live
 * here as pure functions instead of inline branches inside the editor controller (AUD-08). The
 * transport (`platform.ts`) reports *that* a conflict happened; this module decides what the
 * next attempt should be, and how two paths are compared.
 */

/**
 * Compare two native paths the way the platform does. Windows paths are case-insensitive and
 * separator-insensitive, and `/foo` and `\foo` on the same drive are the same file. A UNC share
 * (`\\server\share`) is folded the same way. Anything else compares byte-for-byte, because on
 * Linux `Notes.md` and `notes.md` are different files.
 */
export function sameNativePath(a: string, b: string): boolean {
  return nativePathKey(a) === nativePathKey(b);
}

/** Lower-cased, backslash-normalized key for Windows-style paths; the input otherwise. */
export function nativePathKey(path: string): string {
  return /^(?:[a-z]:[\\/]|\\\\)/iu.test(path) ? path.replace(/\//gu, '\\').toLowerCase() : path;
}

/** What the user chose in the "File changed on disk" dialog. */
export type ConflictChoice = 'cancel' | 'save-as' | 'overwrite';

export interface ConflictStep {
  /** False when the save stops here; the document keeps its unsaved state. */
  retry: boolean;
  /** Ask the user for a different destination before retrying. */
  chooseTarget: boolean;
  /** Retry with the destination's version check disabled (`force`). */
  force: boolean;
}

/**
 * Map a dialog choice to the next save attempt.
 * - `save-as` picks a new destination and re-runs the *normal* check, so an existing file at the
 *   new path is caught too.
 * - `overwrite` retries the same destination with the version check disabled.
 * - `cancel` stops; nothing is written.
 */
export function planConflictRetry(choice: ConflictChoice): ConflictStep {
  switch (choice) {
    case 'save-as': return { retry: true, chooseTarget: true, force: false };
    case 'overwrite': return { retry: true, chooseTarget: false, force: true };
    case 'cancel': return { retry: false, chooseTarget: false, force: false };
  }
}

/**
 * What the next write attempt should tell the transport. Only a save to the *same* file it was
 * opened from may carry the recorded hash and identity; any other destination starts unchecked.
 */
export function saveAttempt(input: { sameTarget: boolean; hash: string | null }): { expected: string | null } {
  return { expected: input.sameTarget ? input.hash : null };
}
