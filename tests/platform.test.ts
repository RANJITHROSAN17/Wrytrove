import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { MAX_FILE_BYTES } from '../src/encoding';
import { collectOpenedFiles, describeNativeSaveMetadata, pickFiles, readNative, writeTo, ExternalChangeError, NativeFileTooLargeError, NativeSaveError } from '../src/platform';

const ID = '0123456789abcdef0123456789abcdef';
const NEXT_ID = 'fedcba9876543210fedcba9876543210';
const nativeFrame = (text: string, identity = ID) => new TextEncoder().encode(identity + text).buffer;

beforeEach(() => { vi.resetAllMocks(); });

describe('independent file opening', () => {
  it('opens the valid native files and reports each unreadable or oversized item', async () => {
    vi.mocked(open).mockResolvedValue(['C:\\work\\one.txt', 'C:\\work\\huge.log', 'C:\\work\\locked.txt', 'C:\\work\\two.txt']);
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      expect(command).toBe('workspace_read_file');
      const { path, maxBytes } = args as { path: string; maxBytes: number };
      expect(maxBytes).toBe(MAX_FILE_BYTES);
      if (path.endsWith('locked.txt')) throw new Error('Permission denied');
      if (path.endsWith('huge.log')) throw new Error('File exceeds the 20 MiB limit for this operation.');
      return nativeFrame(path.endsWith('one.txt') ? 'first' : 'other');
    });

    const result = await pickFiles();
    expect(result.files.map((file) => file.name)).toEqual(['one.txt', 'two.txt']);
    expect(result.failures).toEqual([
      { name: 'huge.log', message: 'File exceeds the 20 MiB limit for this operation.' },
      { name: 'locked.txt', message: 'Permission denied' },
    ]);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('returns no files and no failures when the native dialog is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null);
    expect(await pickFiles()).toEqual({ files: [], failures: [] });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('offers large mode only for the explicit open path and preserves the size rejection', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('WRYTROVE_LARGE_FILE: File exceeds the 1024-byte limit for this operation.');
    await expect(readNative('C:\\work\\file.log', 1024)).rejects.toBeInstanceOf(NativeFileTooLargeError);
    expect(invoke).toHaveBeenCalledWith('workspace_read_file', {
      path: 'C:\\work\\file.log', maxBytes: 1024, offerLargeView: true,
    });
  });

  it('requires a valid identity envelope while preserving arbitrary file bytes', async () => {
    const payload = new Uint8Array([...new TextEncoder().encode(ID), 0, 255, 10]);
    vi.mocked(invoke).mockResolvedValueOnce(payload.buffer)
      .mockResolvedValueOnce(nativeFrame('text', '-'.repeat(32)))
      .mockResolvedValueOnce(new Uint8Array([1, 2]).buffer)
      .mockResolvedValueOnce(nativeFrame('text', 'z'.repeat(32)));
    const opened = await readNative('C:\\test.txt');
    expect([...opened.bytes]).toEqual([0, 255, 10]);
    expect(opened.ref).toMatchObject({ kind: 'native', identity: ID });
    const unverified = await readNative('C:\\test.txt');
    expect(unverified.ref.kind === 'native' && unverified.ref.identity).toBeUndefined();
    await expect(readNative('C:\\test.txt')).rejects.toThrow('Invalid native file response');
    await expect(readNative('C:\\test.txt')).rejects.toThrow('Invalid native file identity');
  });

  it('continues after a loader throws and processes items sequentially', async () => {
    const calls: string[] = [];
    const result = await collectOpenedFiles(['a', 'bad', 'c'], async (name) => {
      calls.push(`start:${name}`);
      await Promise.resolve();
      calls.push(`end:${name}`);
      if (name === 'bad') throw 'read failed';
      return { name, bytes: new Uint8Array([1]), ref: { kind: 'download' } };
    }, (name) => name);
    expect(calls).toEqual(['start:a', 'end:a', 'start:bad', 'end:bad', 'start:c', 'end:c']);
    expect(result.files.map((file) => file.name)).toEqual(['a', 'c']);
    expect(result.failures).toEqual([{ name: 'bad', message: 'read failed' }]);
  });
});

describe('native save IPC safety metadata', () => {
  let ref: { kind: 'native'; path: string; identity?: string };
  const bytes = new TextEncoder().encode('new text\r\n');
  beforeEach(() => { ref = { kind: 'native', path: 'C:\\notes\\draft.txt' }; });

  it('sends an absent sentinel for a new destination and retains the committed identity', async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: 'committed', identity: NEXT_ID });
    const result = await writeTo(ref, bytes, 'draft.txt', null);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.nativeMetadata).toEqual({ permissions: 'unknown' });
    expect(ref.identity).toBe(NEXT_ID);
    expect(invoke).toHaveBeenCalledWith('safe_write', bytes, { headers: {
      'x-wrytrove-path': encodeURIComponent(ref.path), 'x-wrytrove-expected': 'absent',
      'x-wrytrove-identity': 'none', 'x-wrytrove-force': '0',
    } });
  });

  it('sends the opened identity and updates it for the next save', async () => {
    const hash = 'a'.repeat(64);
    ref.identity = ID;
    vi.mocked(invoke).mockResolvedValue({ phase: 'committed', identity: NEXT_ID });
    await writeTo(ref, bytes, 'draft.txt', hash);
    expect(invoke).toHaveBeenLastCalledWith('safe_write', bytes, { headers: {
      'x-wrytrove-path': encodeURIComponent(ref.path), 'x-wrytrove-expected': hash,
      'x-wrytrove-identity': ID, 'x-wrytrove-force': '0',
    } });
    expect(ref.identity).toBe(NEXT_ID);
    await writeTo(ref, bytes, 'draft.txt', hash, true);
    expect(invoke).toHaveBeenLastCalledWith('safe_write', bytes, { headers: {
      'x-wrytrove-path': encodeURIComponent(ref.path), 'x-wrytrove-expected': hash,
      'x-wrytrove-identity': NEXT_ID, 'x-wrytrove-force': '1',
    } });
  });

  it('reports the staged permissions operation without treating missing or malformed reports as failed writes', async () => {
    for (const [metadata, permissions] of [
      [{ permissions: 'copied_to_temp', acl: 'not_verified', other: 'not_verified' }, 'copied_to_temp'],
      [{ permissions: 'not_applied', acl: 'not_verified', other: 'not_verified' }, 'not_applied'],
      [undefined, 'unknown'], [null, 'unknown'], [{ permissions: 'preserved' }, 'unknown'],
    ] as const) {
      vi.mocked(invoke).mockResolvedValueOnce({ phase: 'committed', identity: NEXT_ID, metadata });
      const result = await writeTo(ref, bytes, 'draft.txt', null);
      expect(result.nativeMetadata).toEqual({ permissions });
      expect(ref.identity).toBe(NEXT_ID);
    }
    const copied = describeNativeSaveMetadata({ permissions: 'copied_to_temp' });
    expect(copied).toContain('temporary file');
    expect(copied).toContain('final permissions were not verified');
    for (const permissions of ['copied_to_temp', 'not_applied', 'unknown'] as const) {
      expect(describeNativeSaveMetadata({ permissions })).toContain('ACLs and other metadata were not verified and may change');
    }
  });

  it('requires conflict handling when the identity is missing, including recovered tabs', async () => {
    await expect(writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64))).rejects.toBeInstanceOf(ExternalChangeError);
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(invoke).mockResolvedValue({ phase: 'committed', identity: NEXT_ID });
    await writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64), true);
    expect(ref.identity).toBe(NEXT_ID);
  });

  it('does not treat an unavailable post-save identity as a failed committed save', async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: 'committed', identity: null });
    await expect(writeTo(ref, bytes, 'draft.txt', null)).resolves.toMatchObject({ digest: expect.stringMatching(/^[0-9a-f]{64}$/u), nativeMetadata: { permissions: 'unknown' } });
    expect(ref.identity).toBeUndefined();
    await expect(writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64))).rejects.toBeInstanceOf(ExternalChangeError);
  });

  it('reports structured failures and treats replace errors as uncertain', async () => {
    ref.identity = ID;
    vi.mocked(invoke).mockRejectedValueOnce({ phase: 'flush_temp', kind: 'failure', message: 'disk full' });
    await expect(writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64))).rejects.toMatchObject({ phase: 'flush_temp', message: expect.stringContaining('flush the temporary file') });
    expect(ref.identity).toBe(ID);
    vi.mocked(invoke).mockRejectedValueOnce({ phase: 'replace', kind: 'failure', message: 'I/O error' });
    await expect(writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64))).rejects.toMatchObject({ phase: 'replace', message: expect.stringContaining('outcome is uncertain') });
    expect(ref.identity).toBeUndefined();
    await expect(writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64))).rejects.toBeInstanceOf(ExternalChangeError);
  });

  it('does not claim a malformed or lost response is a failed or successful save', async () => {
    for (const outcome of [null, { phase: 'committed' }, { phase: 'bogus', identity: ID }]) {
      ref.identity = ID;
      vi.mocked(invoke).mockResolvedValueOnce(outcome);
      await expect(writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64))).rejects.toMatchObject({ phase: 'unknown', message: expect.stringContaining('outcome is unknown') });
      expect(ref.identity).toBeUndefined();
    }
    ref.identity = ID;
    vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC disconnected'));
    await expect(writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64))).rejects.toBeInstanceOf(NativeSaveError);
    expect(ref.identity).toBeUndefined();
  });

  it('rejects invalid metadata before IPC and translates conflict errors', async () => {
    for (const invalid of ['', 'absent', 'not-a-hash', 'A'.repeat(64)]) {
      await expect(writeTo(ref, bytes, 'draft.txt', invalid)).rejects.toThrow(/Invalid saved file version/);
    }
    ref.identity = 'malformed';
    await expect(writeTo(ref, bytes, 'draft.txt', 'a'.repeat(64))).rejects.toThrow(/Invalid saved file identity/);
    expect(invoke).not.toHaveBeenCalled();
    ref.identity = undefined;
    vi.mocked(invoke).mockRejectedValue({ phase: 'verify', kind: 'conflict', message: 'WRYTROVE_FILE_CHANGED: destination already exists' });
    await expect(writeTo(ref, bytes, 'draft.txt', null)).rejects.toBeInstanceOf(ExternalChangeError);
  });
});

describe('focus-time native file checking', () => {
  it('compares hash and identity and distinguishes read failures', async () => {
    const { checkNativeFileChange } = await import('../src/platform');
    const { sha256 } = await import('../src/encoding');
    const hash = await sha256(new TextEncoder().encode('original'));
    vi.mocked(invoke).mockResolvedValueOnce(nativeFrame('original')).mockResolvedValueOnce(nativeFrame('original', NEXT_ID))
      .mockResolvedValueOnce(nativeFrame('external edit')).mockRejectedValueOnce(new Error('access denied'));
    expect(await checkNativeFileChange('C:\\notes\\draft.txt', hash, ID)).toBe('unchanged');
    expect(await checkNativeFileChange('C:\\notes\\draft.txt', hash, ID)).toBe('changed');
    expect(await checkNativeFileChange('C:\\notes\\draft.txt', hash, ID)).toBe('changed');
    expect(await checkNativeFileChange('C:\\notes\\draft.txt', hash, ID)).toBe('unavailable');
  });
  it('treats an unknown hash or identity as unverified', async () => {
    const { checkNativeFileChange } = await import('../src/platform');
    const { sha256 } = await import('../src/encoding');
    vi.mocked(invoke).mockResolvedValue(nativeFrame('text'));
    expect(await checkNativeFileChange('C:\\notes\\draft.txt', null)).toBe('changed');
    expect(await checkNativeFileChange('C:\\notes\\draft.txt', await sha256(new TextEncoder().encode('text')))).toBe('unavailable');
  });
});
