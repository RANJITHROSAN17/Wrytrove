import { isTauri, invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { MAX_FILE_BYTES, sha256 } from './encoding';

export const desktop = isTauri();

// The File System Access API is present in current Chromium/WebView2, but not all TS DOM versions.
type BrowserPicker = { showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>; showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle> };
export type FileRef = { kind: 'native'; path: string; identity?: string } | { kind: 'browser'; handle: FileSystemFileHandle } | { kind: 'download' };
export interface OpenedFile { name: string; bytes: Uint8Array; ref: FileRef; displayPath?: string; }
export interface OpenFailure { name: string; message: string; }
export interface OpenFilesResult { files: OpenedFile[]; failures: OpenFailure[]; }
/** Operations reported for the staged file; none guarantee final metadata preservation. */
export type NativePermissionAction = 'copied_to_temp' | 'not_applied' | 'unknown';
export interface NativeSaveMetadata { permissions: NativePermissionAction; }
export interface WriteOutcome { digest: string; nativeMetadata?: NativeSaveMetadata; }

/** Honest user-facing description of what the save reported, not a metadata guarantee. */
export function describeNativeSaveMetadata(metadata: NativeSaveMetadata): string {
  const permissions = metadata.permissions === 'copied_to_temp'
    ? 'A basic permissions value was applied to the temporary file; final permissions were not verified.'
    : metadata.permissions === 'not_applied'
      ? 'No existing permissions value was applied to the temporary file.'
      : 'Whether a permissions value was applied to the temporary file is unknown.';
  return `${permissions} ACLs and other metadata were not verified and may change.`;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function checkSize(size: number): void {
  if (size > MAX_FILE_BYTES) throw new Error('This file is larger than the 20 MiB safety limit.');
}

export class NativeFileTooLargeError extends Error {}

export async function pickNativePaths(): Promise<string[]> {
  const result = await open({ multiple: true, directory: false, title: 'Open a text or code file' });
  return Array.isArray(result) ? result : result ? [result] : [];
}

export async function readNative(path: string, editableLimit?: number, offerLargeView = editableLimit !== undefined): Promise<OpenedFile> {
  // Native code returns a fixed-width identity prefix and bytes from the same bounded open handle.
  const request = { path, maxBytes: editableLimit ?? MAX_FILE_BYTES, ...(offerLargeView ? { offerLargeView: true } : {}) };
  const data = await invoke<ArrayBuffer>('workspace_read_file', request).catch((error: unknown) => {
    const prefix = 'WRYTROVE_LARGE_FILE: ';
    if (typeof error === 'string' && error.startsWith(prefix)) throw new NativeFileTooLargeError(error.slice(prefix.length));
    throw error;
  });
  const framed = new Uint8Array(data);
  if (framed.length < 32) throw new Error('Invalid native file response.');
  const token = new TextDecoder().decode(framed.subarray(0, 32));
  if (!/^[0-9a-f]{32}$/u.test(token) && token !== '-'.repeat(32)) throw new Error('Invalid native file identity.');
  const bytes = framed.slice(32);
  if (bytes.length > (editableLimit ?? MAX_FILE_BYTES)) throw new NativeFileTooLargeError('File exceeded the editable size budget.');
  return { name: fileName(path), bytes, ref: { kind: 'native', path, identity: token === '-'.repeat(32) ? undefined : token } };
}

/** Check only an already-authorized native path; keep read failures distinct from no change. */
export async function checkNativeFileChange(path: string, expectedHash: string | null, expectedIdentity?: string): Promise<'changed' | 'unchanged' | 'unavailable'> {
  try {
    const file = await readNative(path);
    const hash = await sha256(file.bytes);
    if (expectedHash === null || hash !== expectedHash) return 'changed';
    if (file.ref.kind !== 'native' || !expectedIdentity || !file.ref.identity) return 'unavailable';
    return file.ref.identity === expectedIdentity ? 'unchanged' : 'changed';
  } catch { return 'unavailable'; }
}

async function readBrowser(handle: FileSystemFileHandle): Promise<OpenedFile> {
  const file = await handle.getFile();
  checkSize(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkSize(bytes.length);
  return { name: file.name, bytes, ref: { kind: 'browser', handle } };
}

async function readInputFile(file: File): Promise<OpenedFile> {
  checkSize(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkSize(bytes.length);
  return { name: file.name, bytes, ref: { kind: 'download' } };
}

/** Process each selected item independently and avoid simultaneous large-file reads. */
export async function collectOpenedFiles<T>(items: readonly T[], load: (item: T) => Promise<OpenedFile>, name: (item: T) => string): Promise<OpenFilesResult> {
  const result: OpenFilesResult = { files: [], failures: [] };
  for (const item of items) {
    try { result.files.push(await load(item)); }
    catch (error) { result.failures.push({ name: name(item), message: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}

function selectWithInput(): Promise<OpenFilesResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      collectOpenedFiles(files, readInputFile, (file) => file.name).then(resolve, reject);
    }, { once: true });
    // Modern browsers fire cancel; older ones simply leave this promise pending on cancel.
    input.addEventListener('cancel', () => { input.remove(); resolve({ files: [], failures: [] }); }, { once: true });
    input.click();
  });
}

export async function pickFiles(): Promise<OpenFilesResult> {
  if (desktop) return collectOpenedFiles(await pickNativePaths(), readNative, fileName);
  const picker = (window as Window & BrowserPicker).showOpenFilePicker;
  if (picker) {
    let handles: FileSystemFileHandle[];
    try { handles = await picker.call(window, { multiple: true }); }
    catch (error) {
      if ((error as DOMException).name === 'AbortError') return { files: [], failures: [] };
      if ((error as DOMException).name !== 'SecurityError' && (error as DOMException).name !== 'NotAllowedError') throw error;
      return selectWithInput();
    }
    return collectOpenedFiles(handles, readBrowser, (handle) => handle.name);
  }
  return selectWithInput();
}

/** Returns null on cancellation. A native save dialog has already asked before replacing an existing file. */
export async function chooseSaveTarget(suggestedName: string): Promise<{ name: string; ref: FileRef } | null> {
  if (desktop) {
    const path = await save({ defaultPath: suggestedName, title: 'Save file as' });
    return path ? { name: fileName(path), ref: { kind: 'native', path } } : null;
  }
  const picker = (window as Window & BrowserPicker).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName });
      return { name: handle.name, ref: { kind: 'browser', handle } };
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return null;
      if ((error as DOMException).name !== 'SecurityError' && (error as DOMException).name !== 'NotAllowedError') throw error;
    }
  }
  return { name: suggestedName, ref: { kind: 'download' } };
}

export class ExternalChangeError extends Error {
  constructor() { super('The file has changed on disk since it was opened.'); this.name = 'ExternalChangeError'; }
}

export type NativeSavePhase = 'request' | 'verify' | 'create_temp' | 'write_temp' | 'flush_temp' | 'preserve_permissions' | 'revalidate' | 'replace' | 'unknown';
const savePhaseMessages: Record<NativeSavePhase, string> = {
  request: 'The save request was rejected.',
  verify: 'Could not verify the destination.',
  create_temp: 'Could not create the temporary file.',
  write_temp: 'Could not write the temporary file.',
  flush_temp: 'Could not flush the temporary file.',
  preserve_permissions: 'Could not apply permissions to the temporary file.',
  revalidate: 'Could not recheck the destination.',
  replace: 'The replacement outcome is uncertain. Check the destination before retrying.',
  unknown: 'The save outcome is unknown. Check the destination before retrying.',
};

export class NativeSaveError extends Error {
  constructor(public readonly phase: NativeSavePhase, detail?: string) {
    super(`${savePhaseMessages[phase]}${detail ? ` ${detail}` : ''}`);
    this.name = 'NativeSaveError';
  }
}

function nativeSaveFailure(error: unknown): { phase: NativeSavePhase; kind: 'conflict' | 'failure'; message: string } | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as Record<string, unknown>;
  if (typeof value.phase !== 'string' || !Object.hasOwn(savePhaseMessages, value.phase)
      || (value.kind !== 'failure' && value.kind !== 'conflict') || typeof value.message !== 'string') return null;
  return { phase: value.phase as NativeSavePhase, kind: value.kind, message: value.message };
}

/** Write to a user-selected destination. Native path uses a same-directory temporary file. */
export async function writeTo(ref: FileRef, bytes: Uint8Array, name: string, expectedHash: string | null, force = false): Promise<WriteOutcome> {
  const digest = await sha256(bytes);
  let nativeMetadata: NativeSaveMetadata | undefined;
  if (ref.kind === 'native') {
    // Raw IPC uses non-empty validated headers; neither missing identity nor malformed metadata
    // grants permission to overwrite an existing file.
    if (expectedHash !== null && !/^[0-9a-f]{64}$/u.test(expectedHash)) throw new Error('Invalid saved file version.');
    if (ref.identity !== undefined && !/^[0-9a-f]{32}$/u.test(ref.identity)) throw new Error('Invalid saved file identity.');
    if (expectedHash !== null && !force && ref.identity === undefined) throw new ExternalChangeError();
    let result: unknown;
    try {
      result = await invoke<unknown>('safe_write', bytes, { headers: {
        'x-wrytrove-path': encodeURIComponent(ref.path),
        'x-wrytrove-expected': expectedHash ?? 'absent',
        'x-wrytrove-identity': ref.identity ?? 'none',
        'x-wrytrove-force': force ? '1' : '0',
      } });
    } catch (error) {
      const failure = nativeSaveFailure(error);
      if (failure?.kind === 'conflict' && ['verify', 'revalidate', 'replace'].includes(failure.phase)) throw new ExternalChangeError();
      const phase = failure?.phase ?? 'unknown';
      if (phase === 'replace' || phase === 'unknown') ref.identity = undefined;
      throw new NativeSaveError(phase, failure?.message);
    }
    if (!result || typeof result !== 'object' || (result as Record<string, unknown>).phase !== 'committed') {
      ref.identity = undefined;
      throw new NativeSaveError('unknown');
    }
    const identity = (result as Record<string, unknown>).identity;
    if (identity !== null && (typeof identity !== 'string' || !/^[0-9a-f]{32}$/u.test(identity))) {
      ref.identity = undefined;
      throw new NativeSaveError('unknown');
    }
    // A missing or unrecognized advisory report must not turn a committed write
    // into an uncertain failure and invite a duplicate retry.
    const metadata = (result as Record<string, unknown>).metadata;
    const permissions = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).permissions : undefined;
    nativeMetadata = { permissions: permissions === 'copied_to_temp' || permissions === 'not_applied' ? permissions : 'unknown' };
    // Null means the write committed but the next normal save needs conflict handling.
    ref.identity = identity ?? undefined;
  } else if (ref.kind === 'browser') {
    if (expectedHash && !force) {
      const current = await ref.handle.getFile();
      checkSize(current.size);
      if (await sha256(new Uint8Array(await current.arrayBuffer())) !== expectedHash) throw new ExternalChangeError();
    }
    const writable = await ref.handle.createWritable();
    try { await writable.write(new Uint8Array(bytes)); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
  } else {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { digest, ...(nativeMetadata ? { nativeMetadata } : {}) };
}

export function refPath(ref: FileRef | null): string | null {
  return ref?.kind === 'native' ? ref.path : null;
}
