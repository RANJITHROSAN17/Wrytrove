// Pure draft-journal format for AUD-02. No IndexedDB or DOM access lives here so the
// rules (chunking, verification, three-way classification, garbage collection) are testable.
// Recovery is a crash-safety aid, not a backup: the file on disk remains authoritative.
import type { LineEnding, TextEncoding } from './encoding';
import { MAX_FILE_BYTES, sha256 } from './encoding';

export const JOURNAL_VERSION = 2;
/** Code units per content chunk. Chunks never split a surrogate pair. */
export const CHUNK_CHARS = 64 * 1024;
/** Per-document cap: the largest file the editor will open. */
export const MAX_DOCUMENT_DRAFT_BYTES = MAX_FILE_BYTES;
/** Total cap across every document's retained journal entries. */
export const MAX_JOURNAL_TOTAL_BYTES = 100 * 1024 * 1024;

const encodings = new Set<TextEncoding>(['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE']);
const lineEndings = new Set<LineEnding>(['LF', 'CRLF', 'CR']);

/** Versioned header for one complete draft. Only written after every chunk is stored. */
export interface JournalManifest {
  version: typeof JOURNAL_VERSION;
  docId: string;
  /** Opaque token derived by the caller; raw paths are not stored in the index. */
  pathToken: string | null;
  /** Disk hash when the draft was captured, or null for an unsaved new document. */
  baseHash: string | null;
  sequence: number;
  timestamp: number;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  cursor: number;
  chunkCount: number;
  byteLength: number;
  /** SHA-256 of the UTF-8 text, used to verify reassembly and to compare against disk. */
  contentHash: string;
}

export interface JournalChunk {
  docId: string;
  sequence: number;
  index: number;
  data: string;
}

export interface DraftInput {
  docId: string;
  pathToken: string | null;
  baseHash: string | null;
  sequence: number;
  timestamp: number;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  cursor: number;
  text: string;
}

const encoder = new TextEncoder();

/** Split text into chunks without cutting a UTF-16 surrogate pair across a boundary. */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  if (!Number.isInteger(size) || size < 2) throw new Error('Chunk size must be an integer of at least 2.');
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1; // keep the high surrogate with its pair
    }
    if (end <= start) end = Math.min(text.length, start + 2);
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/** Build the manifest and chunks for one draft. Throws if the draft exceeds the per-document cap. */
export async function buildJournalEntry(input: DraftInput): Promise<{ manifest: JournalManifest; chunks: JournalChunk[] }> {
  validateInput(input);
  const byteLength = utf8ByteLength(input.text);
  if (byteLength > MAX_DOCUMENT_DRAFT_BYTES) throw new JournalLimitError('document', byteLength);
  const pieces = chunkText(input.text);
  const contentHash = await sha256(encoder.encode(input.text));
  const manifest: JournalManifest = {
    version: JOURNAL_VERSION,
    docId: input.docId,
    pathToken: input.pathToken,
    baseHash: input.baseHash,
    sequence: input.sequence,
    timestamp: input.timestamp,
    encoding: input.encoding,
    lineEnding: input.lineEnding,
    cursor: input.cursor,
    chunkCount: pieces.length,
    byteLength,
    contentHash,
  };
  const chunks = pieces.map((data, index) => ({ docId: input.docId, sequence: input.sequence, index, data }));
  return { manifest, chunks };
}

/**
 * Reassemble a draft. Returns null (never a partial text) unless every chunk is present,
 * in order, belongs to this document and sequence, and the hash matches the manifest.
 */
export async function assembleJournalEntry(manifest: JournalManifest, chunks: JournalChunk[]): Promise<DraftInput | null> {
  if (!isValidManifest(manifest) || chunks.length !== manifest.chunkCount) return null;
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  for (let i = 0; i < ordered.length; i += 1) {
    const chunk = ordered[i];
    if (chunk.index !== i || chunk.docId !== manifest.docId || chunk.sequence !== manifest.sequence || typeof chunk.data !== 'string') return null;
  }
  const text = ordered.map((chunk) => chunk.data).join('');
  if (utf8ByteLength(text) !== manifest.byteLength) return null;
  if (await sha256(encoder.encode(text)) !== manifest.contentHash) return null;
  return {
    docId: manifest.docId, pathToken: manifest.pathToken, baseHash: manifest.baseHash,
    sequence: manifest.sequence, timestamp: manifest.timestamp, encoding: manifest.encoding,
    lineEnding: manifest.lineEnding, cursor: manifest.cursor, text,
  };
}

export function isValidManifest(value: unknown): value is JournalManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<JournalManifest>;
  return m.version === JOURNAL_VERSION
    && typeof m.docId === 'string' && m.docId.length > 0 && m.docId.length <= 200
    && (m.pathToken === null || (typeof m.pathToken === 'string' && m.pathToken.length <= 200))
    && (m.baseHash === null || typeof m.baseHash === 'string')
    && Number.isSafeInteger(m.sequence) && (m.sequence as number) >= 0
    && Number.isFinite(m.timestamp)
    && typeof m.encoding === 'string' && encodings.has(m.encoding)
    && typeof m.lineEnding === 'string' && lineEndings.has(m.lineEnding)
    && Number.isSafeInteger(m.cursor) && (m.cursor as number) >= 0
    && Number.isSafeInteger(m.chunkCount) && (m.chunkCount as number) >= 0
    && Number.isSafeInteger(m.byteLength) && (m.byteLength as number) >= 0 && (m.byteLength as number) <= MAX_DOCUMENT_DRAFT_BYTES
    && typeof m.contentHash === 'string' && /^[0-9a-f]{64}$/.test(m.contentHash);
}

function validateInput(input: DraftInput): void {
  if (!input.docId || input.docId.length > 200) throw new Error('Draft needs a document id of 1 to 200 characters.');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) throw new Error('Draft sequence must be a non-negative integer.');
  if (!encodings.has(input.encoding) || !lineEndings.has(input.lineEnding)) throw new Error('Draft has an unknown encoding or line ending.');
  if (!Number.isSafeInteger(input.cursor) || input.cursor < 0 || input.cursor > input.text.length) throw new Error('Draft cursor is outside the text.');
}

export class JournalLimitError extends Error {
  constructor(readonly scope: 'document' | 'total', readonly bytes: number) {
    super(`Recovery draft exceeds the ${scope} limit (${bytes} bytes).`);
    this.name = 'JournalLimitError';
  }
}

/**
 * Compare a recovered draft with the file on disk right now.
 * - equal-hash: the draft already matches disk; nothing to restore.
 * - draft-newer: disk is unchanged since the draft was captured, so the draft is the newer work.
 * - disk-newer: disk changed after the draft's base; the user must compare, never auto-apply.
 * - unsaved: the draft has no base file (a new document).
 */
export type RecoveryRelation = 'equal-hash' | 'draft-newer' | 'disk-newer' | 'unsaved';

export function classifyDraft(draft: Pick<DraftInput, 'baseHash'> & { contentHash: string }, diskHash: string | null): RecoveryRelation {
  if (diskHash !== null && draft.contentHash === diskHash) return 'equal-hash';
  if (draft.baseHash === null) return 'unsaved';
  if (diskHash !== null && draft.baseHash === diskHash) return 'draft-newer';
  return 'disk-newer';
}

export interface JournalRecordSummary {
  docId: string;
  sequence: number;
  timestamp: number;
  byteLength: number;
}

export interface RetentionLimits {
  perDocumentBytes: number;
  totalBytes: number;
}

/**
 * Decide which complete entries to delete. The newest complete entry of every document is
 * always kept, even when caps are exceeded, so a cap can never remove the current draft.
 * Older entries are dropped oldest-first until the caps hold.
 */
export function planGarbageCollection(records: JournalRecordSummary[], limits: RetentionLimits = { perDocumentBytes: MAX_DOCUMENT_DRAFT_BYTES, totalBytes: MAX_JOURNAL_TOTAL_BYTES }): JournalRecordSummary[] {
  const newestByDoc = new Map<string, number>();
  for (const r of records) newestByDoc.set(r.docId, Math.max(newestByDoc.get(r.docId) ?? -1, r.sequence));
  const isProtected = (r: JournalRecordSummary) => newestByDoc.get(r.docId) === r.sequence;
  const deletions: JournalRecordSummary[] = [];
  const removed = new Set<JournalRecordSummary>();

  // Per-document: drop older entries whose total for that document exceeds the cap.
  const byDoc = new Map<string, JournalRecordSummary[]>();
  for (const r of records) byDoc.set(r.docId, [...(byDoc.get(r.docId) ?? []), r]);
  for (const entries of byDoc.values()) {
    let total = entries.reduce((sum, r) => sum + r.byteLength, 0);
    const oldestFirst = entries.filter((r) => !isProtected(r)).sort((a, b) => a.sequence - b.sequence);
    for (const r of oldestFirst) {
      if (total <= limits.perDocumentBytes) break;
      total -= r.byteLength; removed.add(r); deletions.push(r);
    }
  }

  // Total: sequences are per document, so age across documents is judged by timestamp.
  let total = records.reduce((sum, r) => sum + r.byteLength, 0) - [...removed].reduce((s, r) => s + r.byteLength, 0);
  const candidates = records.filter((r) => !removed.has(r) && !isProtected(r)).sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
  for (const r of candidates) {
    if (total <= limits.totalBytes) break;
    total -= r.byteLength; removed.add(r); deletions.push(r);
  }
  return deletions;
}

/**
 * Next sequence for a document's draft. Sequences are wall-clock based, so a later launch always
 * writes a larger sequence than an earlier one, even though the in-memory counter is reset.
 */
export function nextJournalSequence(previous: number, nowMs: number): number {
  if (!Number.isSafeInteger(previous) || previous < -1) throw new Error('Previous sequence must be a safe integer of at least -1.');
  return Math.max(previous + 1, Math.trunc(nowMs));
}

/**
 * Choose the text to restore for a tab. The journal is written before the legacy snapshot, so a
 * draft that differs from the snapshot is the newer text. An identical draft adds nothing.
 */
export function chooseRestoreText(snapshotText: string, draft: Pick<DraftInput, 'text'> | null): 'draft' | 'snapshot' {
  if (!draft) return 'snapshot';
  return draft.text === snapshotText ? 'snapshot' : 'draft';
}
