import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { writeTo } from '../src/platform';

/**
 * `safe_write` hands Tauri a raw `Uint8Array` payload, and Tauri only turns that into
 * `InvokeBody::Raw` on its IPC custom protocol. If the webview refuses that fetch — a CSP that
 * does not allow the `ipc` host, or a platform that blocks the custom protocol — it silently
 * retries the same call through `window.ipc.postMessage`, where the payload is JSON instead.
 *
 * `processIpcMessage` below is a verbatim copy of `crates/tauri/scripts/process-ipc-message-fn.js`
 * from tauri 2.12.7, the version pinned in `src-tauri/Cargo.lock`. Copying it instead of mocking
 * it away is the point: it decides the body type `safe_write` receives, and no unit test
 * exercised it before. `invoke_payload_bytes` in `src-tauri/src/lib.rs` must accept every shape
 * this function can produce.
 */
const SERIALIZE_TO_IPC_FN = '__TAURI_TO_IPC_KEY__';

function processIpcMessage(message: unknown): { contentType: string; data: unknown } {
  if (
    message instanceof ArrayBuffer
    || ArrayBuffer.isView(message)
    || Array.isArray(message)
  ) {
    return { contentType: 'application/octet-stream', data: message };
  }
  const data = JSON.stringify(message, (_key, value: unknown) => {
    if (value instanceof Map) return Object.fromEntries(value.entries());
    if (value instanceof Uint8Array) return Array.from(value);
    if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
    if (typeof value === 'object' && value !== null && SERIALIZE_TO_IPC_FN in value) {
      return (value as Record<string, () => unknown>)[SERIALIZE_TO_IPC_FN]();
    }
    return value;
  });
  return { contentType: 'application/json', data };
}

const SAVE_HEADERS = {
  'x-wrytrove-path': encodeURIComponent('C:\\work\\notes.md'),
  'x-wrytrove-expected': 'absent',
  'x-wrytrove-identity': 'none',
  'x-wrytrove-force': '0',
};

/** What the IPC custom protocol delivers: the payload itself, sent as octet-stream. */
function customProtocolRequest(payload: unknown): { contentType: string; payload: Uint8Array } {
  const { contentType, data } = processIpcMessage(payload);
  expect(contentType).toBe('application/octet-stream');
  return { contentType, payload: new Uint8Array(data as ArrayBufferLike) };
}

/** What `window.ipc.postMessage` delivers: the whole call wrapped in a JSON envelope. */
function postMessageRequest(payload: unknown): { contentType: string; payload: unknown; headers: Record<string, string> } {
  const { contentType, data } = processIpcMessage({ cmd: 'safe_write', callback: '1', error: '2', payload, options: { headers: SAVE_HEADERS } });
  expect(contentType).toBe('application/json');
  const envelope = JSON.parse(data as string) as { payload: unknown; options: { headers: Record<string, string> } };
  return { contentType, payload: envelope.payload, headers: envelope.options.headers };
}

const bytes = new TextEncoder().encode('draft body');

beforeEach(() => { vi.resetAllMocks(); });

describe('safe_write IPC body', () => {
  it('passes the document as a raw Uint8Array payload, not a JSON argument', async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: 'committed', identity: null });
    await writeTo({ kind: 'native', path: 'C:\\work\\notes.md' }, bytes, 'notes.md', null);
    const [command, payload, options] = vi.mocked(invoke).mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(command).toBe('safe_write');
    // A Uint8Array (or ArrayBuffer) is what makes Tauri send application/octet-stream.
    expect(payload).toBeInstanceOf(Uint8Array);
    expect(options.headers).toEqual(SAVE_HEADERS);
  });

  it('becomes InvokeBody::Raw on the IPC custom protocol', () => {
    const request = customProtocolRequest(bytes);
    expect(request.contentType).toBe('application/octet-stream');
    expect(new TextDecoder().decode(request.payload)).toBe('draft body');
  });

  it('still carries the same bytes after the postMessage fallback re-serializes it', () => {
    // The fallback wraps the whole call in an object, so the payload degrades to a JSON number
    // array. The Rust decoder must read that back into the original bytes.
    const request = postMessageRequest(bytes);
    expect(Array.isArray(request.payload)).toBe(true);
    expect(new TextDecoder().decode(new Uint8Array(request.payload as number[]))).toBe('draft body');
  });

  it('keeps the path and conflict headers on either transport', () => {
    expect(postMessageRequest(bytes).headers).toEqual(SAVE_HEADERS);
    expect(decodeURIComponent(SAVE_HEADERS['x-wrytrove-path'])).toBe('C:\\work\\notes.md');
  });
});
