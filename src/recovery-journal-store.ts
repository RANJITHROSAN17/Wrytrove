// IndexedDB store for the draft journal (AUD-02, encryption AUD-03). Each draft is written in
// one readwrite transaction: all chunks plus the manifest. IndexedDB commits or aborts the
// transaction as a whole, so a manifest is never visible without its chunks. Older complete
// entries are only removed after a newer one has committed.
//
// Encryption is optional per write. When a key ring is passed, the manifest and each chunk's
// text are sealed with AES-256-GCM; the document id and sequence stay in clear so retention can
// run without any key. Plaintext and sealed rows can coexist, for example after encryption is
// turned on or off.
import {
  assembleJournalEntry, buildJournalEntry, isValidManifest, planGarbageCollection,
  type DraftInput, type JournalChunk, type JournalManifest, type JournalRecordSummary,
} from './recovery-journal';
import {
  isSealedRecord, KeyUnavailableError, openText, sealText, type JournalKeyRing, type SealedRecord,
} from './recovery-crypto';

export const JOURNAL_DB = 'wrytrove-draft-journal-v2';
const MANIFESTS = 'manifests';
const CHUNKS = 'journal';

export interface CommitResult {
  saved: boolean;
  quotaExceeded: boolean;
  /** True when encryption was requested but the key was not available; nothing was written. */
  keyUnavailable: boolean;
  /** Sequence of the last complete draft still stored for this document after the attempt. */
  lastCompleteSequence: number | null;
}

export interface RecoveryRead {
  /** Newest verified draft per document that could be read. */
  drafts: DraftInput[];
  /** Entries skipped because chunks were missing or failed verification. */
  skipped: number;
  /**
   * Documents whose newest draft is sealed with a key that is not loaded. They are not
   * replaced by an older draft; the UI must offer an explicit export or delete decision.
   */
  locked: string[];
}

interface SealedManifestRow {
  version: number;
  docId: string;
  sequence: number;
  timestamp: number;
  byteLength: number;
  sealed: SealedRecord;
}

interface SealedChunkRow {
  docId: string;
  sequence: number;
  index: number;
  sealed: SealedRecord;
}

type ManifestRow = JournalManifest | SealedManifestRow;
type ChunkRow = JournalChunk | SealedChunkRow;

/** Index view used for retention and counts. It never requires decryption. */
interface IndexRow {
  docId: string;
  sequence: number;
  timestamp: number;
  byteLength: number;
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

// Writes, reads and garbage collection share one queue so they never interleave.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}

const isSealedManifestRow = (row: unknown): row is SealedManifestRow => {
  if (!row || typeof row !== 'object') return false;
  const r = row as Partial<SealedManifestRow>;
  return typeof r.docId === 'string' && r.docId.length > 0 && r.docId.length <= 200
    && Number.isSafeInteger(r.sequence) && (r.sequence as number) >= 0
    && Number.isFinite(r.timestamp)
    && Number.isSafeInteger(r.byteLength) && (r.byteLength as number) >= 0
    && isSealedRecord(r.sealed);
};

function indexOf(row: unknown): IndexRow | null {
  if (isValidManifest(row)) return { docId: row.docId, sequence: row.sequence, timestamp: row.timestamp, byteLength: row.byteLength };
  if (isSealedManifestRow(row)) return { docId: row.docId, sequence: row.sequence, timestamp: row.timestamp, byteLength: row.byteLength };
  return null;
}

/** Store a complete draft, then collect older entries under the retention caps. */
export function commitDraft(input: DraftInput, ring: JournalKeyRing | null = null): Promise<CommitResult> {
  return serial(async () => {
    const fail = async (extra: Partial<CommitResult> = {}): Promise<CommitResult> => ({
      saved: false, quotaExceeded: false, keyUnavailable: false,
      lastCompleteSequence: await lastCompleteSequence(input.docId), ...extra,
    });
    let manifestRow: ManifestRow;
    let chunkRows: ChunkRow[];
    try {
      const entry = await buildJournalEntry(input);
      if (ring) {
        const sealedManifest = await sealText(JSON.stringify(entry.manifest), ring, { kind: 'manifest', docId: input.docId, sequence: input.sequence });
        manifestRow = { version: entry.manifest.version, docId: input.docId, sequence: input.sequence, timestamp: input.timestamp, byteLength: entry.manifest.byteLength, sealed: sealedManifest };
        chunkRows = [];
        for (const chunk of entry.chunks) {
          const sealed = await sealText(chunk.data, ring, { kind: 'chunk', docId: input.docId, sequence: input.sequence, index: chunk.index });
          chunkRows.push({ docId: input.docId, sequence: input.sequence, index: chunk.index, sealed });
        }
      } else {
        manifestRow = entry.manifest;
        chunkRows = entry.chunks;
      }
    } catch (error) {
      if (error instanceof KeyUnavailableError) return fail({ keyUnavailable: true });
      return fail();
    }
    try {
      await writeAtomically([MANIFESTS, CHUNKS], (tx) => {
        const chunks = tx.objectStore(CHUNKS);
        for (const chunk of chunkRows) chunks.put(chunk);
        tx.objectStore(MANIFESTS).put(manifestRow);
      });
    } catch (error) {
      // The transaction aborted as a whole, so the previous complete draft is intact.
      return fail({ quotaExceeded: isQuota(error) });
    }
    await collectGarbage();
    return { saved: true, quotaExceeded: false, keyUnavailable: false, lastCompleteSequence: input.sequence };
  });
}

async function listIndex(): Promise<IndexRow[]> {
  const db = await open();
  const tx = db.transaction(MANIFESTS, 'readonly');
  const all = await req(tx.objectStore(MANIFESTS).getAll());
  return all.map(indexOf).filter((row): row is IndexRow => row !== null);
}

async function lastCompleteSequence(docId: string): Promise<number | null> {
  try {
    const mine = (await listIndex()).filter((m) => m.docId === docId).map((m) => m.sequence);
    return mine.length ? Math.max(...mine) : null;
  } catch { return null; }
}

async function collectGarbage(): Promise<void> {
  try {
    const records: JournalRecordSummary[] = await listIndex();
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

type Resolution = { kind: 'ok'; draft: DraftInput } | { kind: 'locked' } | { kind: 'bad' };

async function resolveEntry(manifestRow: ManifestRow, chunkRows: ChunkRow[], ring: JournalKeyRing | null): Promise<Resolution> {
  let manifest: JournalManifest;
  const chunks: JournalChunk[] = [];
  try {
    if (isSealedManifestRow(manifestRow)) {
      if (!ring) return { kind: 'locked' };
      const parsed: unknown = JSON.parse(await openText(manifestRow.sealed, ring, { kind: 'manifest', docId: manifestRow.docId, sequence: manifestRow.sequence }));
      if (!isValidManifest(parsed) || parsed.docId !== manifestRow.docId || parsed.sequence !== manifestRow.sequence) return { kind: 'bad' };
      manifest = parsed;
    } else if (isValidManifest(manifestRow)) {
      manifest = manifestRow;
    } else {
      return { kind: 'bad' };
    }
    for (const row of chunkRows) {
      if ('sealed' in row) {
        if (!ring) return { kind: 'locked' };
        chunks.push({ docId: row.docId, sequence: row.sequence, index: row.index, data: await openText(row.sealed, ring, { kind: 'chunk', docId: row.docId, sequence: row.sequence, index: row.index }) });
      } else {
        chunks.push(row);
      }
    }
  } catch (error) {
    if (error instanceof KeyUnavailableError) return { kind: 'locked' };
    return { kind: 'bad' };
  }
  const draft = await assembleJournalEntry(manifest, chunks);
  return draft ? { kind: 'ok', draft } : { kind: 'bad' };
}

/**
 * Return the newest readable draft for each document. A damaged entry is skipped and the
 * next-older complete entry is tried. A document whose newest entry is locked is reported in
 * `locked` and is not replaced by an older draft.
 */
export async function readRecoveryDrafts(ring: JournalKeyRing | null = null): Promise<RecoveryRead> {
  return serial(async () => {
    const db = await open();
    const tx = db.transaction([MANIFESTS, CHUNKS], 'readonly');
    const manifests = await req(tx.objectStore(MANIFESTS).getAll()) as unknown[];
    const chunkRows = await req(tx.objectStore(CHUNKS).getAll()) as ChunkRow[];
    const byKey = new Map<string, ChunkRow[]>();
    for (const row of chunkRows) {
      const key = `${row.docId}\u0000${row.sequence}`;
      const list = byKey.get(key);
      if (list) list.push(row); else byKey.set(key, [row]);
    }
    const valid = manifests
      .map((row) => ({ row, index: indexOf(row) }))
      .filter((entry): entry is { row: ManifestRow; index: IndexRow } => entry.index !== null);
    const newestFirst = [...valid].sort((a, b) => a.index.docId.localeCompare(b.index.docId) || b.index.sequence - a.index.sequence);

    const drafts: DraftInput[] = [];
    const locked: string[] = [];
    let skipped = 0;
    const finished = new Set<string>();
    for (const { row, index } of newestFirst) {
      if (finished.has(index.docId)) continue;
      const chunks = byKey.get(`${index.docId}\u0000${index.sequence}`) ?? [];
      const outcome = await resolveEntry(row, chunks, ring);
      if (outcome.kind === 'ok') { drafts.push(outcome.draft); finished.add(index.docId); }
      else if (outcome.kind === 'locked') { locked.push(index.docId); finished.add(index.docId); }
      else skipped += 1;
    }
    return { drafts, skipped, locked };
  });
}

/** Remove every journal entry for one document, e.g. after the user discards a draft. Needs no key. */
export function deleteDraftsFor(docId: string): Promise<void> {
  return serial(async () => {
    await writeAtomically([MANIFESTS, CHUNKS], (tx) => {
      tx.objectStore(MANIFESTS).delete(IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]));
      tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([docId, -Infinity, -Infinity], [docId, Infinity, Infinity]));
    });
  });
}

/** Remove every draft, e.g. when the user turns recovery off. Needs no key. */
export function clearAllDrafts(): Promise<void> {
  return serial(async () => {
    await writeAtomically([MANIFESTS, CHUNKS], (tx) => {
      tx.objectStore(MANIFESTS).clear();
      tx.objectStore(CHUNKS).clear();
    });
  });
}
