import { LargeFileSearch } from './large-file-search';

let search: LargeFileSearch | undefined;
self.onmessage = (event: MessageEvent<{ query: string; regex: boolean } | { bytes: ArrayBuffer; eof: boolean }>) => {
  try {
    const data = event.data;
    if ('query' in data) {
      search = new LargeFileSearch(data.query, data.regex);
      self.postMessage({ ready: true });
    } else if (search) {
      self.postMessage({ batch: search.push(new Uint8Array(data.bytes), data.eof) });
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
