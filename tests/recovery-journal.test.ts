import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_DRAFT_BYTES, assembleJournalEntry, buildJournalEntry, chunkText, classifyDraft,
  planGarbageCollection, type DraftInput, type JournalRecordSummary,
} from '../src/recovery-journal';
import { sha256 } from '../src/encoding';

const draft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  docId: 'doc-a', pathToken: 'tok-1', baseHash: 'a'.repeat(64), sequence: 1, timestamp: 1000,
  encoding: 'UTF-8', lineEnding: 'LF', cursor: 3, text: 'abc', ...overrides,
});

describe('chunkText', () => {
  it('reassembles exactly and respects the chunk size', () => {
    const text = 'x'.repeat(25);
    const chunks = chunkText(text, 10);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 5]);
    expect(chunks.join('')).toBe(text);
  });

  it('never splits a surrogate pair across chunks', () => {
    const text = 'a'.repeat(9) + '😀' + 'b'.repeat(5); // emoji is two UTF-16 units at index 9-10
    const chunks = chunkText(text, 10);
    expect(chunks.join('')).toBe(text);
    for (const c of chunks) {
      const last = c.charCodeAt(c.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it('returns no chunks for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });
});

describe('journal entries', () => {
  it('round-trips text, cursor, encoding and line ending', async () => {
    const input = draft({ text: 'Hello 😀\r\nnew line', cursor: 5, encoding: 'UTF-8 BOM', lineEnding: 'CRLF' });
    const { manifest, chunks } = await buildJournalEntry(input);
    expect(manifest.contentHash).toBe(await sha256(new TextEncoder().encode(input.text)));
    expect(await assembleJournalEntry(manifest, chunks)).toEqual(input);
  });

  it('refuses to present a draft with a missing chunk', async () => {
    const { manifest, chunks } = await buildJournalEntry(draft({ text: 'x'.repeat(150_000) }));
    expect(chunks.length).toBeGreaterThan(1);
    expect(await assembleJournalEntry(manifest, chunks.slice(1))).toBeNull();
  });

  it('refuses tampered content, a foreign sequence, or a mismatched manifest', async () => {
    const { manifest, chunks } = await buildJournalEntry(draft());
    expect(await assembleJournalEntry(manifest, [{ ...chunks[0], data: 'abX' }])).toBeNull();
    expect(await assembleJournalEntry(manifest, [{ ...chunks[0], sequence: 2 }])).toBeNull();
    expect(await assembleJournalEntry({ ...manifest, byteLength: 99 }, chunks)).toBeNull();
  });

  it('accepts out-of-order chunks because they are sorted by index', async () => {
    const { manifest, chunks } = await buildJournalEntry(draft({ text: 'y'.repeat(140_000) }));
    expect((await assembleJournalEntry(manifest, [...chunks].reverse()))?.text).toBe('y'.repeat(140_000));
  });

  it('rejects a draft over the per-document cap', async () => {
    const text = 'x'.repeat(MAX_DOCUMENT_DRAFT_BYTES + 1);
    await expect(buildJournalEntry(draft({ text, cursor: 0 }))).rejects.toThrow(/document limit/);
  });

  it('validates the cursor and sequence before writing', async () => {
    await expect(buildJournalEntry(draft({ cursor: 99 }))).rejects.toThrow(/cursor/);
    await expect(buildJournalEntry(draft({ sequence: -1 }))).rejects.toThrow(/sequence/);
  });
});

describe('classifyDraft', () => {
  const hash = 'b'.repeat(64);
  it('distinguishes equal, draft-newer, disk-newer and unsaved', () => {
    expect(classifyDraft({ baseHash: 'a'.repeat(64), contentHash: hash }, hash)).toBe('equal-hash');
    expect(classifyDraft({ baseHash: hash, contentHash: 'c'.repeat(64) }, hash)).toBe('draft-newer');
    expect(classifyDraft({ baseHash: 'a'.repeat(64), contentHash: 'c'.repeat(64) }, hash)).toBe('disk-newer');
    expect(classifyDraft({ baseHash: null, contentHash: 'c'.repeat(64) }, hash)).toBe('unsaved');
  });

  it('treats a missing disk file as disk-newer when the draft has a base', () => {
    expect(classifyDraft({ baseHash: 'a'.repeat(64), contentHash: 'c'.repeat(64) }, null)).toBe('disk-newer');
  });
});

describe('planGarbageCollection', () => {
  const rec = (docId: string, sequence: number, timestamp: number, byteLength: number): JournalRecordSummary =>
    ({ docId, sequence, timestamp, byteLength });

  it('never deletes the newest entry of a document, even over the caps', () => {
    const records = [rec('a', 1, 1, 500), rec('a', 2, 2, 500)];
    const doomed = planGarbageCollection(records, { perDocumentBytes: 100, totalBytes: 100 });
    expect(doomed).toEqual([rec('a', 1, 1, 500)]);
  });

  it('drops oldest entries of one document until its cap holds', () => {
    const records = [rec('a', 1, 1, 40), rec('a', 2, 2, 40), rec('a', 3, 3, 40)];
    expect(planGarbageCollection(records, { perDocumentBytes: 90, totalBytes: 1e9 }).map((r) => r.sequence)).toEqual([1]);
  });

  it('applies the total cap across documents by age, not by per-document sequence', () => {
    // Each document keeps its newest entry; the oldest unprotected entry overall is b#1 (timestamp 100).
    const records = [
      rec('a', 1, 300, 60), rec('a', 2, 400, 60),
      rec('b', 1, 100, 60), rec('b', 2, 500, 60),
      rec('c', 1, 200, 60), rec('c', 2, 600, 60),
    ];
    const doomed = planGarbageCollection(records, { perDocumentBytes: 1e9, totalBytes: 300 });
    expect(doomed).toEqual([rec('b', 1, 100, 60)]);
  });
});
