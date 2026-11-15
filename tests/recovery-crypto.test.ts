import { describe, expect, it } from 'vitest';
import {
  generateJournalKey, isSealedRecord, KeyUnavailableError, openBytes, openText, sealText, unavailableKeyProvider,
  type JournalKeyRing,
} from '../src/recovery-crypto';

const ring = async (activeKeyId: string, ids: string[]): Promise<JournalKeyRing> => {
  const keys = new Map<string, CryptoKey>();
  for (const id of ids) keys.set(id, await generateJournalKey());
  return { activeKeyId, keys };
};
const aad = { kind: 'chunk' as const, docId: 'doc-1', sequence: 3, index: 0 };

describe('sealed recovery records', () => {
  it('round-trips text with the same associated data', async () => {
    const r = await ring('k1', ['k1']);
    const sealed = await sealText('secret draft 😀', r, aad);
    expect(isSealedRecord(sealed)).toBe(true);
    expect(await openText(sealed, r, aad)).toBe('secret draft 😀');
  });

  it('does not contain the plaintext in the stored ciphertext', async () => {
    const r = await ring('k1', ['k1']);
    const secret = 'PLAINTEXT-MARKER-12345';
    const sealed = await sealText(secret, r, aad);
    const ct = Buffer.from(sealed.ct);
    expect(ct.includes(Buffer.from(secret))).toBe(false);
    expect(sealed.ct.byteLength).toBeGreaterThan(secret.length);
  });

  it('refuses to open a record moved to another document, sequence, index or kind', async () => {
    const r = await ring('k1', ['k1']);
    const sealed = await sealText('x', r, aad);
    await expect(openText(sealed, r, { ...aad, index: 1 })).rejects.toThrow(/authentication/);
    await expect(openText(sealed, r, { ...aad, sequence: 4 })).rejects.toThrow(/authentication/);
    await expect(openText(sealed, r, { ...aad, docId: 'doc-2' })).rejects.toThrow(/authentication/);
    await expect(openText(sealed, r, { kind: 'manifest', docId: 'doc-1', sequence: 3 })).rejects.toThrow(/authentication/);
  });

  it('refuses a tampered ciphertext', async () => {
    const r = await ring('k1', ['k1']);
    const sealed = await sealText('original', r, aad);
    sealed.ct[0] ^= 0xff;
    await expect(openBytes(sealed, r, aad)).rejects.toThrow(/authentication/);
  });

  it('reports a missing key as KeyUnavailableError rather than as corruption', async () => {
    const writer = await ring('k1', ['k1']);
    const sealed = await sealText('x', writer, aad);
    const reader = await ring('k2', ['k2']);
    await expect(openText(sealed, reader, aad)).rejects.toBeInstanceOf(KeyUnavailableError);
  });

  it('keeps reading old keys after rotation while new writes use the active key', async () => {
    const k1 = await generateJournalKey();
    const k2 = await generateJournalKey();
    const before = await sealText('old', { activeKeyId: 'k1', keys: new Map([['k1', k1]]) }, aad);
    const after = await sealText('new', { activeKeyId: 'k2', keys: new Map([['k1', k1], ['k2', k2]]) }, aad);
    expect(after.keyId).toBe('k2');
    const rotated: JournalKeyRing = { activeKeyId: 'k2', keys: new Map([['k1', k1], ['k2', k2]]) };
    expect(await openText(before, rotated, aad)).toBe('old');
    expect(await openText(after, rotated, aad)).toBe('new');
  });

  it('rejects malformed records before touching any key', () => {
    expect(isSealedRecord(null)).toBe(false);
    expect(isSealedRecord({ v: 1, keyId: 'k', iv: new Uint8Array(11), ct: new Uint8Array(16) })).toBe(false);
    expect(isSealedRecord({ v: 2, keyId: 'k', iv: new Uint8Array(12), ct: new Uint8Array(16) })).toBe(false);
  });

  it('the default provider cannot supply a key, so encryption cannot be silently enabled', async () => {
    await expect(unavailableKeyProvider.load()).rejects.toBeInstanceOf(KeyUnavailableError);
  });

  it('generates non-extractable keys', async () => {
    const key = await generateJournalKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });
});
