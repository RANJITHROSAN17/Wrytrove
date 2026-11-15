// AUD-03: authenticated encryption for recovery drafts (AES-256-GCM via WebCrypto).
// This module never stores keys. Key material comes from a JournalKeyProvider, which on
// Windows is expected to unwrap a random journal key with DPAPI in the Rust layer. Until
// that provider exists, encryption cannot be enabled and drafts remain plaintext.
// Associated data binds every record to its kind, document, sequence and chunk index, so a
// record cannot be moved or replayed into another position and still authenticate.

export const SEALED_VERSION = 1;
const IV_BYTES = 12;
const TAG_BITS = 128;

/** One encrypted payload. Only keyId, iv and ciphertext are stored; no plaintext or path. */
export interface SealedRecord {
  v: typeof SEALED_VERSION;
  keyId: string;
  iv: Uint8Array;
  ct: Uint8Array;
}

export interface AssociatedData {
  kind: 'manifest' | 'chunk';
  docId: string;
  sequence: number;
  /** Chunk index; omitted for manifests. */
  index?: number;
}

/** Keys currently usable. Rotation keeps old keys to read records sealed before the change. */
export interface JournalKeyRing {
  activeKeyId: string;
  keys: ReadonlyMap<string, CryptoKey>;
}

/** Thrown when the OS-protected key is locked, missing or not provisioned. */
export class KeyUnavailableError extends Error {
  constructor(message = 'The recovery encryption key is unavailable.') {
    super(message);
    this.name = 'KeyUnavailableError';
  }
}

/** Abstraction over the OS-protected key store. Must throw KeyUnavailableError when locked. */
export interface JournalKeyProvider {
  load(): Promise<JournalKeyRing>;
}

/** Default provider until a platform implementation exists: encryption cannot be enabled. */
export const unavailableKeyProvider: JournalKeyProvider = {
  load: () => Promise.reject(new KeyUnavailableError('Recovery encryption needs an OS-protected key, which this platform does not provide yet.')),
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function associatedBytes(aad: AssociatedData): Uint8Array {
  return encoder.encode(JSON.stringify([SEALED_VERSION, aad.kind, aad.docId, aad.sequence, aad.index ?? -1]));
}

export function isSealedRecord(value: unknown): value is SealedRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<SealedRecord>;
  return r.v === SEALED_VERSION
    && typeof r.keyId === 'string' && r.keyId.length > 0 && r.keyId.length <= 200
    && r.iv instanceof Uint8Array && r.iv.byteLength === IV_BYTES
    && r.ct instanceof Uint8Array && r.ct.byteLength >= TAG_BITS / 8;
}

/** Generate a non-extractable AES-256-GCM key. Callers must not persist it outside the key provider. */
export function generateJournalKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;
}

export async function sealBytes(plain: Uint8Array, ring: JournalKeyRing, aad: AssociatedData): Promise<SealedRecord> {
  const key = ring.keys.get(ring.activeKeyId);
  if (!key) throw new KeyUnavailableError('The active recovery key is not loaded.');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedBytes(aad) as BufferSource, tagLength: TAG_BITS }, key, plain as BufferSource));
  return { v: SEALED_VERSION, keyId: ring.activeKeyId, iv, ct };
}

/** Decrypt a record. Throws KeyUnavailableError if its key is not loaded, or Error on failed authentication. */
export async function openBytes(record: SealedRecord, ring: JournalKeyRing, aad: AssociatedData): Promise<Uint8Array> {
  if (!isSealedRecord(record)) throw new Error('Recovery record is malformed.');
  const key = ring.keys.get(record.keyId);
  if (!key) throw new KeyUnavailableError('The recovery record was sealed with a key that is not loaded.');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv as BufferSource, additionalData: associatedBytes(aad) as BufferSource, tagLength: TAG_BITS }, key, record.ct as BufferSource);
    return new Uint8Array(plain);
  } catch {
    throw new Error('Recovery record failed authentication.');
  }
}

export function sealText(text: string, ring: JournalKeyRing, aad: AssociatedData): Promise<SealedRecord> {
  return sealBytes(encoder.encode(text), ring, aad);
}

export async function openText(record: SealedRecord, ring: JournalKeyRing, aad: AssociatedData): Promise<string> {
  const plain = await openBytes(record, ring, aad);
  return decoder.decode(plain);
}
