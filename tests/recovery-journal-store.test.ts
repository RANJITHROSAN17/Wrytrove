import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildJournalEntry, CHUNK_CHARS, type DraftInput } from '../src/recovery-journal';
import { commitDraft, deleteDraftsFor, JOURNAL_DB, readRecoveryDrafts } from '../src/recovery-journal-store';
import { generateJournalKey, type JournalKeyRing } from '../src/recovery-crypto';

const draft = (docId: string, sequence: number, text: string): DraftInput => ({
  docId, pathToken: null, baseHash: null, sequence, timestamp: 1000 + sequence,
  encoding: 'UTF-8', lineEnding: 'LF', cursor: 0, text,
});

/** Count raw rows for one document, bypassing the reader that hides older entries. */
function rowsFor(store: 'manifests' | 'journal', docId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(JOURNAL_DB, 1);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => { db.close(); resolve((req.result as { docId: string }[]).filter((row) => row.docId === docId).length); };
      req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
  });
}

/** All raw rows for one document, as IndexedDB stores them. */
function rawRows(store: 'manifests' | 'journal', docId: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(JOURNAL_DB, 1);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => { db.close(); resolve((req.result as { docId: string }[]).filter((row) => row.docId === docId)); };
      req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
  });
}

async function ringOf(activeKeyId: string, ids: string[]): Promise<JournalKeyRing> {
  const keys = new Map<string, CryptoKey>();
  for (const id of ids) keys.set(id, await generateJournalKey());
  return { activeKeyId, keys };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('draft journal store', () => {
  it('stores a draft and restores its text, cursor and encoding', async () => {
    const id = 'store-roundtrip';
    const input = { ...draft(id, 1, 'Hello 😀 world'), cursor: 4, encoding: 'UTF-16 LE' as const, lineEnding: 'CRLF' as const };
    expect(await commitDraft(input)).toMatchObject({ saved: true, quotaExceeded: false, lastCompleteSequence: 1 });
    const { drafts, skipped } = await readRecoveryDrafts();
    expect(skipped).toBe(0);
    expect(drafts.find((d) => d.docId === id)).toEqual(input);
  });

  it('keeps older complete drafts as a timeline while newest is returned for recovery', async () => {
    const id = 'store-timeline';
    await commitDraft(draft(id, 1, 'x'.repeat(CHUNK_CHARS + 10)));
    await commitDraft(draft(id, 2, 'newer text'));
    const { drafts } = await readRecoveryDrafts();
    expect(drafts.find((d) => d.docId === id)?.text).toBe('newer text');
    // Both complete drafts are within caps, so both stay: 2 manifests and 3 chunks (2 + 1).
    expect(await rowsFor('manifests', id)).toBe(2);
    expect(await rowsFor('journal', id)).toBe(3);
  });

  it('simulates a crash after a manifest without chunks and falls back to the last complete draft', async () => {
    const id = 'store-crash';
    await commitDraft(draft(id, 1, 'complete draft'));
    // Simulate a half-written newer entry: manifest present, chunks never stored.
    const { manifest } = await buildJournalEntry(draft(id, 2, 'lost text'));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(JOURNAL_DB, 1);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('manifests', 'readwrite');
        tx.objectStore('manifests').put(manifest);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    const { drafts, skipped } = await readRecoveryDrafts();
    expect(skipped).toBeGreaterThanOrEqual(1);
    expect(drafts.find((d) => d.docId === id)).toMatchObject({ sequence: 1, text: 'complete draft' });
  });

  it('a quota failure mid-transaction commits nothing and keeps the previous complete draft', async () => {
    const id = 'store-quota';
    await commitDraft(draft(id, 1, 'previous complete draft'));
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      // Fail on the second chunk, after the first chunk has already been queued.
      if (value && typeof value === 'object' && 'index' in value && (value as { index: number; docId: string }).docId === id && (value as { index: number }).index === 1) {
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return originalPut.call(this, value as never, key);
    });
    const result = await commitDraft(draft(id, 2, 'x'.repeat(CHUNK_CHARS * 2)));
    vi.restoreAllMocks();
    expect(result).toMatchObject({ saved: false, quotaExceeded: true, lastCompleteSequence: 1 });
    expect(await rowsFor('manifests', id)).toBe(1);
    // The first chunk of the failed write must not have been committed.
    expect(await rowsFor('journal', id)).toBe(1);
    const { drafts } = await readRecoveryDrafts();
    expect(drafts.find((d) => d.docId === id)).toMatchObject({ sequence: 1, text: 'previous complete draft' });
  });

  it('removes every entry for a discarded document', async () => {
    const id = 'store-delete';
    await commitDraft(draft(id, 1, 'to discard'));
    await deleteDraftsFor(id);
    const { drafts } = await readRecoveryDrafts();
    expect(drafts.some((d) => d.docId === id)).toBe(false);
    expect(await rowsFor('manifests', id)).toBe(0);
    expect(await rowsFor('journal', id)).toBe(0);
  });

  describe('encrypted drafts (AUD-03)', () => {
    it('stores no readable text on disk and restores it with the key', async () => {
      const id = 'enc-readable';
      const ring = await ringOf('k1', ['k1']);
      const secret = 'ENCRYPTED-SECRET-' + 'z'.repeat(40);
      expect(await commitDraft(draft(id, 1, secret), ring)).toMatchObject({ saved: true, keyUnavailable: false });
      const raw = JSON.stringify([...(await rawRows('manifests', id)), ...(await rawRows('journal', id))], (_k, v) =>
        v instanceof Uint8Array ? Array.from(v).join(',') : v);
      expect(raw.includes(secret)).toBe(false);
      const { drafts, locked } = await readRecoveryDrafts(ring);
      expect(locked).not.toContain(id);
      expect(drafts.find((d) => d.docId === id)?.text).toBe(secret);
    });

    it('reports a document as locked without a key and never falls back to an older plaintext draft', async () => {
      const id = 'enc-locked';
      await commitDraft(draft(id, 1, 'older plaintext draft'));
      await commitDraft(draft(id, 2, 'newer sealed draft'), await ringOf('k1', ['k1']));
      const { drafts, locked } = await readRecoveryDrafts(null);
      expect(locked).toContain(id);
      expect(drafts.some((d) => d.docId === id)).toBe(false);
    });

    it('keeps reading drafts sealed with an old key after rotation', async () => {
      const id = 'enc-rotate';
      const k1 = await generateJournalKey();
      const k2 = await generateJournalKey();
      await commitDraft(draft(id, 1, 'written under k1'), { activeKeyId: 'k1', keys: new Map([['k1', k1]]) });
      await commitDraft(draft(id, 2, 'written under k2'), { activeKeyId: 'k2', keys: new Map([['k1', k1], ['k2', k2]]) });
      const rotated = await readRecoveryDrafts({ activeKeyId: 'k2', keys: new Map([['k1', k1], ['k2', k2]]) });
      expect(rotated.drafts.find((d) => d.docId === id)?.text).toBe('written under k2');
      // The newest draft is sealed with k2 only, so a reader holding k2 alone still recovers it.
      const onlyNew = await readRecoveryDrafts({ activeKeyId: 'k2', keys: new Map([['k2', k2]]) });
      expect(onlyNew.drafts.find((d) => d.docId === id)?.text).toBe('written under k2');
    });

    it('does not write anything when the key is unavailable', async () => {
      const id = 'enc-no-key';
      const empty: JournalKeyRing = { activeKeyId: 'missing', keys: new Map() };
      expect(await commitDraft(draft(id, 1, 'cannot seal'), empty)).toMatchObject({ saved: false, keyUnavailable: true });
      expect(await rawRows('manifests', id)).toHaveLength(0);
      expect(await rawRows('journal', id)).toHaveLength(0);
    });

    it('deletes a locked document without needing its key', async () => {
      const id = 'enc-discard';
      await commitDraft(draft(id, 1, 'sealed'), await ringOf('k1', ['k1']));
      await deleteDraftsFor(id);
      expect(await rawRows('manifests', id)).toHaveLength(0);
      expect((await readRecoveryDrafts(null)).locked).not.toContain(id);
    });
  });
});
