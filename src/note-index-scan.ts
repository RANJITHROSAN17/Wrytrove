import { decodeFile } from './encoding';
import { INDEXABLE_EXTENSIONS, MAX_INDEX_FILE_BYTES } from './note-index';
import { readWorkspaceFile, walkWorkspace, type WorkspaceDirectory } from './workspace';

export interface ScannedNote { name: string; relative: string; rootName: string; text: string; }
export interface NoteScan { files: ScannedNote[]; skipped: number; truncated: boolean; issues: string[]; }
const MAX_NOTES = 1_000;
const MAX_ISSUES = 8;

/** A bounded snapshot of saved notes. Incomplete walks and read errors are never silent. */
export async function scanNoteRoots(roots: readonly WorkspaceDirectory[], signal?: AbortSignal): Promise<NoteScan> {
  const result: NoteScan = { files: [], skipped: 0, truncated: false, issues: [] };
  const names = new Set<string>();
  let attempted = 0;
  const issue = (message: string) => { if (result.issues.length < MAX_ISSUES) result.issues.push(message); };
  for (const root of roots) {
    if (signal?.aborted) break;
    const key = root.name.toLowerCase();
    if (names.has(key)) {
      result.skipped++; issue(`${root.name}: another workspace root has the same name; this root was not indexed.`);
      continue;
    }
    names.add(key);
    try {
      const walk = await walkWorkspace(root, async (entry) => {
        if (signal?.aborted) return false;
        if (!INDEXABLE_EXTENSIONS.test(entry.name)) return;
        if (attempted >= MAX_NOTES) { result.truncated = true; return false; }
        attempted++;
        try {
          const opened = await readWorkspaceFile(entry, MAX_INDEX_FILE_BYTES);
          if (signal?.aborted) return false;
          result.files.push({ name: entry.name, relative: entry.relative, rootName: root.name, text: decodeFile(opened.bytes).text });
        } catch (error) {
          if (signal?.aborted) return false;
          result.skipped++;
          issue(`${root.name}/${entry.relative}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, { signal });
      result.skipped += walk.skipped;
      result.truncated ||= walk.truncated;
      for (const message of walk.issues) issue(`${root.name}/${message}`);
    } catch (error) {
      if (signal?.aborted) break;
      result.skipped++;
      issue(`${root.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.truncated && attempted >= MAX_NOTES) break;
  }
  return result;
}
