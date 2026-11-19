import { invoke } from '@tauri-apps/api/core';
import { decodeLargePage, MAX_MATCHES, MAX_QUERY, SEARCH_CHUNK, type RangeMatch, type SearchBatch } from './large-file-search';

const PAGE = 32 * 1024;
const WORKER_TIMEOUT_MS = 1500;
const SEARCH_TIMEOUT_MS = 120_000;
const SEARCH_TIMEOUT = 'search exceeded the two-minute time budget.';
export interface FileVersion { size: number; version: string; }
export const inspectNativeFile = (path: string) => invoke<FileVersion>('large_file_inspect', { path });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function workerRequest<T>(worker: Worker, request: object, signal: AbortSignal, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.onmessage = worker.onerror = null;
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(signal.reason);
    const timer = setTimeout(() => fail(new Error('Search worker exceeded its time budget. Try a simpler pattern.')), WORKER_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => fail(new Error('Search worker failed.'));
    worker.onmessage = (event: MessageEvent<T & { error?: string }>) => {
      if (event.data.error) fail(new Error(event.data.error));
      else { cleanup(); resolve(event.data); }
    };
    try { worker.postMessage(request, transfer); } catch (error) { fail(error); }
  });
}

/** A modal, not an editor document: no workspace state, recovery, save, or AI hooks. */
export class LargeFileView {
  private readonly dialog = document.querySelector<HTMLDialogElement>('#large-file-dialog')!;
  private session: { path: string; name: string; file: FileVersion; offset: number; loaded: boolean; reading: boolean; search?: AbortController } | null = null;
  private matches: RangeMatch[] = [];
  private outcome = '';
  private scannedBytes = 0;
  private searchPattern = '';
  private regexSearch = false;
  private readQueue = Promise.resolve();

  private field<T extends HTMLElement = HTMLElement>(id: string): T { return this.dialog.querySelector<T>(`#large-${id}`)!; }
  private enable(id: string, enabled: boolean): void { this.field<HTMLButtonElement>(id).disabled = !enabled; }

  constructor() {
    this.field('close').onclick = () => this.dialog.close();
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.dialog.close(); });
    this.field('load').onclick = () => { void this.page(0); };
    this.field('prev').onclick = () => { void this.page((this.session?.offset ?? 0) - PAGE); };
    this.field('next').onclick = () => { void this.page((this.session?.offset ?? 0) + PAGE); };
    this.field<HTMLFormElement>('jump').onsubmit = (event) => {
      event.preventDefault(); void this.page(this.field<HTMLInputElement>('offset').valueAsNumber);
    };
    const query = this.field<HTMLInputElement>('query');
    query.maxLength = MAX_QUERY;
    this.field<HTMLFormElement>('search').onsubmit = (event) => {
      event.preventDefault(); void this.search(query.value, this.field<HTMLInputElement>('regex').checked);
    };
    this.field('cancel').onclick = () => { this.session?.search?.abort(); };
    this.field('export').onclick = () => this.export();
  }

  open(path: string, name: string, file: FileVersion): Promise<void> {
    if (this.session) return Promise.reject(new Error('Close the current large-file viewer before opening another file.'));
    this.reset();
    this.session = { path, name, file, offset: 0, loaded: false, reading: false };
    this.field('name').textContent = name;
    this.field('page-status').textContent = `${file.size.toLocaleString()} bytes. No file content has been read yet.`;
    this.field<HTMLInputElement>('offset').max = String(file.size - 1);
    return new Promise((resolve, reject) => {
      const closed = () => { this.reset(); resolve(); };
      this.dialog.addEventListener('close', closed, { once: true });
      try { this.dialog.showModal(); }
      catch (error) { this.dialog.removeEventListener('close', closed); this.reset(); reject(error); }
    });
  }

  private reset(): void {
    this.session?.search?.abort();
    this.session = null;
    this.matches = [];
    this.outcome = '';
    this.scannedBytes = 0;
    this.searchPattern = '';
    for (const id of ['name', 'text', 'page-status', 'search-status', 'results']) this.field(id).replaceChildren();
    this.field<HTMLInputElement>('query').value = '';
    this.field<HTMLInputElement>('regex').checked = false;
    this.field<HTMLInputElement>('offset').value = '0';
    this.field('tools').hidden = true;
    this.field('load').hidden = false;
    this.enable('load', true);
    this.enable('cancel', false);
    this.enable('export', false);
    this.enable('start', true);
  }

  private read(session: NonNullable<LargeFileView['session']>, offset: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    const task = this.readQueue.then(async () => {
      signal?.throwIfAborted();
      if (this.session !== session || !this.dialog.open) throw new Error('Viewer closed.');
      const data = await invoke<ArrayBuffer>('large_file_range', { path: session.path, version: session.file.version, offset, length });
      if (data.byteLength !== length) throw new Error('The file returned an incomplete range.');
      return data;
    });
    this.readQueue = task.then(() => {}, () => {});
    if (!signal) return task;
    // Do not wait for a blocking native read to acknowledge cancellation. Any
    // read already in flight still holds the queue until its bounded IPC returns.
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      void task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  private async page(requested: number): Promise<void> {
    const session = this.session;
    if (!session || session.reading || !Number.isSafeInteger(requested)) return;
    const offset = Math.min(Math.max(requested, 0), session.file.size - 1);
    const length = Math.min(PAGE, session.file.size - offset);
    const status = this.field('page-status');
    session.reading = true;
    for (const id of ['load', 'prev', 'next', 'go']) this.enable(id, false);
    status.textContent = 'Reading window…';
    this.field('text').textContent = '';
    try {
      const data = await this.read(session, offset, Math.min(length + 3, session.file.size - offset));
      if (this.session !== session || !this.dialog.open) return;
      let text: string;
      try { text = decodeLargePage(new Uint8Array(data), length, offset); }
      catch { throw new Error('This window is not valid UTF-8 text or contains binary data.'); }
      this.field('text').textContent = text;
      this.field('text').scrollTop = this.field('text').scrollLeft = 0;
      session.offset = offset;
      session.loaded = true;
      this.field<HTMLInputElement>('offset').value = String(offset);
      status.textContent = `Byte window [${offset.toLocaleString()}, ${(offset + length).toLocaleString()}) of ${session.file.size.toLocaleString()} bytes. Offsets are zero-based.`;
      this.field('tools').hidden = false;
      if (!this.field('load').hidden) { this.field('load').hidden = true; this.field('text').focus(); }
    } catch (error) {
      if (this.session === session && this.dialog.open) status.textContent = message(error);
    } finally {
      if (this.session === session && this.dialog.open) {
        session.reading = false;
        this.enable('load', !session.loaded);
        this.enable('go', session.loaded);
        this.enable('prev', session.offset > 0);
        this.enable('next', session.offset + PAGE < session.file.size);
      }
    }
  }

  private async search(query: string, regex: boolean): Promise<void> {
    const session = this.session;
    if (!session?.loaded || session.search || !query || !this.dialog.open) return;
    const controller = new AbortController();
    session.search = controller;
    const { signal } = controller;
    const timeout = setTimeout(() => controller.abort(SEARCH_TIMEOUT), SEARCH_TIMEOUT_MS);
    this.matches = [];
    this.scannedBytes = 0;
    this.searchPattern = query;
    this.regexSearch = regex;
    this.field('results').replaceChildren();
    this.enable('export', false);
    this.enable('start', false);
    this.enable('cancel', true);
    const status = this.field('search-status');
    status.textContent = 'Starting search…';
    let worker: Worker | undefined, skipped = 0, limited = false, lastPercent = -1;
    try {
      worker = new Worker(new URL('./large-file.worker.ts', import.meta.url), { type: 'module' });
      await workerRequest(worker, { query, regex }, signal);
      for (let offset = 0; offset < session.file.size && !limited;) {
        signal.throwIfAborted();
        const length = Math.min(SEARCH_CHUNK, session.file.size - offset);
        const bytes = await this.read(session, offset, length, signal);
        offset += length;
        const { batch } = await workerRequest<{ batch: SearchBatch }>(worker, { bytes, eof: offset === session.file.size }, signal, [bytes]);
        signal.throwIfAborted();
        if (!batch.limited) this.scannedBytes = offset;
        skipped += batch.skipped;
        limited = batch.limited;
        for (const match of batch.matches) this.appendMatch(match);
        const percent = Math.floor(100 * this.scannedBytes / session.file.size);
        if (percent !== lastPercent || batch.matches.length) {
          status.textContent = `${percent}% scanned · ${this.matches.length} matches`;
          lastPercent = percent;
        }
      }
      this.outcome = limited ? `Partial: stopped at ${MAX_MATCHES} matches.`
        : skipped ? `Partial: skipped ${skipped.toLocaleString()} lines larger than 256 KiB.` : 'Complete.';
    } catch (error) {
      if (this.session === session && this.dialog.open) {
        this.outcome = signal.aborted && signal.reason !== SEARCH_TIMEOUT ? 'Partial: search cancelled.' : `Partial: ${message(error)}`;
      }
    } finally {
      clearTimeout(timeout);
      worker?.terminate();
      if (this.session === session && this.dialog.open) {
        session.search = undefined;
        status.textContent = `${this.outcome} ${this.matches.length} matches. Fully processed chunks: ${this.scannedBytes.toLocaleString()} / ${session.file.size.toLocaleString()} bytes.`;
        this.enable('cancel', false);
        this.enable('start', true);
        this.enable('export', this.matches.length > 0);
      }
    }
  }

  private appendMatch(match: RangeMatch): void {
    this.matches.push(match);
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Line ${match.line.toLocaleString()} · bytes [${match.start.toLocaleString()}, ${match.end.toLocaleString()})`;
    button.onclick = () => { void this.page(match.start); };
    const excerpt = document.createElement('code');
    excerpt.textContent = match.preview;
    row.append(button, excerpt);
    this.field('results').append(row);
  }

  private export(): void {
    const session = this.session;
    if (!session || !this.matches.length || session.search) return;
    const report = {
      file: session.name, size: session.file.size, offsetConvention: 'zero-based bytes, end exclusive; lines one-based',
      query: this.searchPattern, regex: this.regexSearch, outcome: this.outcome, processedBytes: this.scannedBytes,
      matches: this.matches,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'wrytrove-matched-ranges.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
