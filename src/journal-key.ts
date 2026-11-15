// AUD-03: the recovery journal key provider backed by the Rust DPAPI command `journal_key_load`.
// The key is returned as raw bytes for this session only, imported as a non-extractable CryptoKey,
// and the byte buffer is zeroed. Outside Tauri, or on a platform without DPAPI, the provider reports
// KeyUnavailableError so encryption can never be enabled silently.
import { isTauri, invoke } from '@tauri-apps/api/core';
import { KeyUnavailableError, type JournalKeyProvider, type JournalKeyRing } from './recovery-crypto';

export const JOURNAL_KEY_ID = 'dpapi-v1';
const KEY_BYTES = 32;
const UNAVAILABLE_PREFIX = 'WRYTROVE_KEY_UNAVAILABLE';

function keyUnavailableMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Strip the machine prefix so users see a plain sentence.
  return text.replace(UNAVAILABLE_PREFIX + ':', '').trim() || 'The recovery encryption key is unavailable.';
}

export const nativeJournalKeyProvider: JournalKeyProvider = {
  async load(): Promise<JournalKeyRing> {
    if (!isTauri()) throw new KeyUnavailableError('Recovery encryption needs the Wrytrove desktop app.');
    let raw: ArrayBuffer;
    try {
      raw = await invoke<ArrayBuffer>('journal_key_load');
    } catch (error) {
      throw new KeyUnavailableError(keyUnavailableMessage(error));
    }
    const bytes = new Uint8Array(raw);
    if (bytes.byteLength !== KEY_BYTES) {
      bytes.fill(0);
      throw new KeyUnavailableError('The recovery key has an unexpected length.');
    }
    try {
      const key = await crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return { activeKeyId: JOURNAL_KEY_ID, keys: new Map([[JOURNAL_KEY_ID, key]]) };
    } finally {
      bytes.fill(0);
    }
  },
};
