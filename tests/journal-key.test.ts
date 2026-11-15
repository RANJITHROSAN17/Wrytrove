import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { nativeJournalKeyProvider, JOURNAL_KEY_ID } from '../src/journal-key';
import { KeyUnavailableError, generateJournalKey, sealText, openText } from '../src/recovery-crypto';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(), invoke: vi.fn() }));

const aad = { kind: 'chunk' as const, docId: 'doc-1', sequence: 1, index: 0 };

describe('native journal key provider', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockReset();
  });

  it('turns the native key into a usable, non-extractable ring', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const ring = await nativeJournalKeyProvider.load();
    expect(ring.activeKeyId).toBe(JOURNAL_KEY_ID);
    const key = ring.keys.get(JOURNAL_KEY_ID)!;
    expect(key.extractable).toBe(false);
    const sealed = await sealText('recovered text', ring, aad);
    expect(await openText(sealed, ring, aad)).toBe('recovered text');
  });

  it('reports a locked key as KeyUnavailableError and never generates a replacement', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('WRYTROVE_KEY_UNAVAILABLE: The recovery key could not be unlocked by Windows.'));
    const error = await nativeJournalKeyProvider.load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyUnavailableError);
    expect((error as Error).message).toBe('The recovery key could not be unlocked by Windows.');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('rejects a key of the wrong length', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(new Uint8Array(16).buffer);
    await expect(nativeJournalKeyProvider.load()).rejects.toBeInstanceOf(KeyUnavailableError);
  });

  it('refuses outside the desktop app, so browsers cannot enable encryption', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(nativeJournalKeyProvider.load()).rejects.toBeInstanceOf(KeyUnavailableError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a key from another install cannot open this install\'s records', async () => {
    const other = await generateJournalKey();
    const mine = await generateJournalKey();
    const sealed = await sealText('secret', { activeKeyId: 'k', keys: new Map([['k', other]]) }, aad);
    await expect(openText(sealed, { activeKeyId: 'k', keys: new Map([['k', mine]]) }, aad)).rejects.toThrow('failed authentication');
  });
});
