// IndexedDB store for the AUD-02 draft journal. Each draft is written in one readwrite
// transaction: all chunks plus the manifest. IndexedDB commits or aborts the transaction as a
// whole, so a manifest is never visible without its chunks. Older complete entries are only
// removed after a newer one has committed. The legacy `session` store in storage.ts is untouched.
import {
  assembleJournalEntry, buildJournalEntry, isValidManifest, planGarbageCollection,
  type DraftInput, type JournalChunk, type JournalManifest, type JournalRecordSummary,
} from './recovery-journal';

export const JOURNAL_DB = 'wrytrove-draft-journal-v2';
const MANIFESTS = 'manifests';
const CHUNKS = 'journal';

export interface CommitResult {
  saved: boolean;
  quotaExceeded: boolean;
  /** Sequence of the last complete draft still stored for this document after the attempt. */
  lastCompleteSequence: number | null;
}

export interface RecoveryRead {
  /** Newest verified draft per document. */
  drafts: DraftInput[];
  /** Manifests skipped because chunks were missing or failed verification. */
  skipped: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(JOURNAL_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(MANIFESTS, { keyPath: ['docId', 'sequence'] });
        db.createObjectStore(CHUNKS, { keyPath: ['docId', 'sequence', 'index'] });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { dbPromise = null; reject(request.error || new Error('Unable to open the draft journal.')); };
      request.onblocked = () => { dbPromise = null; reject(new Error('The draft journal is blocked by another window.')); };
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Draft journal transaction failed.'));
    tx.onabort = () => reject(tx.error || new Error('Draft journal transaction was interrupted.'));
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Draft journal read failed.'));
  });
}

/**
 * Run writes in one transaction. A synchronous failure (for example QuotaExceededError thrown
 * by put) aborts the whole transaction, so no partial subset of the writes can commit.
 */
async function writeAtomically(stores: string[], write: (tx: IDBTransaction) => void): Promise<void> {
  const db = await open();
  const tx = db.transaction(stores, 'readwrite');
  const finished = done(tx);
  try {
    write(tx);
  } catch (error) {
    try { tx.abort(); } catch { /* already finished */ }
    await finished.catch(() => undefined);
    throw error;
  }
  await finished;
}

const isQuota = (error: unknown) => (error as { name?: string } | null)?.name === 'QuotaExceededError';

// Writes and garbage collection share one queue so they never interleave.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}

/** Store a complete draft, then collect older entries under the retention caps. */
export function commitDraft(input: DraftInput): Promise<CommitResult> {
  return serial(async () => {
    let entry;
    try { entry = await buildJournalEntry(input); }
    catch { return { saved: false, quotaExceeded: false, lastCompleteSequence: await lastCompleteSequence(input.docId) }; }
    try {
      await writeAtomically([MANIFESTS, CHUNKS], (tx) => {
        const chunks = tx.objectStore(CHUNKS);
        for (const chunk of entry.chunks) chunks.put(chunk);
        tx.objectStore(MANIFESTS).put(entry.manifest);
      });
    } catch (error) {
      // The transaction aborted as a whole, so the previous complete draft is intact.
      return { saved: false, quotaExceeded: isQuota(error), lastCompleteSequence: await lastCompleteSequence(input.docId) };
    }
    await collectGarbage();
    return { saved: true, quotaExceeded: false, lastCompleteSequence: input.sequence };
  });
}

async function lastCompleteSequence(docId: string): Promise<number | null> {
  try {
    const manifests = await listManifests();
    const mine = manifests.filter((m) => m.docId === docId).map((m) => m.sequence);
    return mine.length ? Math.max(...mine) : null;
  } catch { return null; }
}

async function listManifests(): Promise<JournalManifest[]> {
  const db = await open();
  const tx = db.transaction(MANIFESTS, 'readonly');
  const all = await req(tx.objectStore(MANIFESTS).getAll());
  return all.filter(isValidManifest);
}

async function collectGarbage(): Promise<void> {
  try {
    const manifests = await listManifests();
    const records: JournalRecordSummary[] = manifests.map((m) => ({ docId: m.docId, sequence: m.sequence, timestamp: m.timestamp, byteLength: m.byteLength }));
    const doomed = planGarbageCollection(records);
    if (!doomed.length) return;
    await writeAtomically([MANIFESTS, CHUNKS], (tx) => {
      for (const r of doomed) {
        tx.objectStore(MANIFESTS).delete([r.docId, r.sequence]);
        tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([r.docId, r.sequence, -Infinity], [r.docId, r.sequence, Infinity]));
      }
    });
  } catch {
    // Retention is best-effort. Extra entries are harmless; the protected newest entry is never removed.
  }
}

/**
 * Return the newest verified draft for each document. An entry whose chunks are missing or
 * fail verification is skipped and the next-older complete entry is used instead.
 */
export async function readRecoveryDrafts(): Promise<RecoveryRead> {
  return serial(async () => {
    const db = await open();
    const tx = db.transaction([MANIFESTS, CHUNKS], 'readonly');
    const manifests = (await req(tx.objectStore(MANIFESTS).getAll())).filter(isValidManifest);
    const chunkRows = (await req(tx.objectStore(CHUNKS).getAll())) as JournalChunk[];
    const byKey = new Map<string, JournalChunk[]>();
    for (const chunk of chunkRows) {
      const key = `${chunk.docId}\u0000${chunk.sequence}`;
      const list = byKey.get(key);
      if (list) list.push(chunk); else byKey.set(key, [chunk]);
    }
    const newestFirst = [...manifests].sort((a, b) => a.docId.localeCompare(b.docId) || b.sequence - a.sequence);
    const drafts: DraftInput[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const manifest of newestFirst) {
      if (seen.has(manifest.docId)) continue;
      const chunks = byKey.get(`${manifest.docId}\u0000${manifest.sequence}`) ?? [];
      const draft = await assembleJournalEntry(manifest, chunks);
      if (draft) { drafts.push(draft); seen.add(manifest.docId); }
      else skipped += 1;
    }
    return { drafts, skipped };
  });
}

/** Remove every journal entry for one document, e.g. after the user discards a draft. */
export function deleteDraftsFor(docId: string): Promise<void> {
  return serial(async () => {
    await writeAtomically([MANIFESTS, CHUNKS], (tx) => {
      tx.objectStore(MANIFESTS).delete(IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]));
      tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([docId, -Infinity, -Infinity], [docId, Infinity, Infinity]));
    });
  });
}
