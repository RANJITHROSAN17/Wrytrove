/** Large-file search is line-local and case-sensitive. UTF-8 offsets are zero-based. */
export const SEARCH_CHUNK = 256 * 1024;
export const MAX_LINE = 256 * 1024;
export const MAX_MATCHES = 200;
export const MAX_QUERY = 512;
export interface RangeMatch { start: number; end: number; line: number; preview: string; }
export interface SearchBatch { matches: RangeMatch[]; skipped: number; limited: boolean; }

export class LargeFileSearch {
  private readonly lineBytes = new Uint8Array(MAX_LINE);
  private readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  private readonly encoder = new TextEncoder();
  private readonly regex: RegExp | null;
  private length = 0;
  private overflow = false;
  private start = 0;
  private offset = 0;
  private line = 1;
  private count = 0;

  constructor(private readonly query: string, regex: boolean) {
    if (!query || query.length > MAX_QUERY) throw new Error(`Enter a pattern of 1–${MAX_QUERY} characters.`);
    if (/[\uD800-\uDFFF]/u.test(query)) throw new Error('The search pattern contains invalid Unicode.');
    this.regex = regex ? new RegExp(query, 'gu') : null;
  }

  push(bytes: Uint8Array, eof: boolean): SearchBatch {
    const batch: SearchBatch = { matches: [], skipped: 0, limited: false };
    let from = 0;
    while (from < bytes.length) {
      const newline = bytes.indexOf(10, from);
      const end = newline < 0 ? bytes.length : newline;
      if (!this.overflow && this.length + end - from <= MAX_LINE) {
        this.lineBytes.set(bytes.subarray(from, end), this.length);
        this.length += end - from;
      } else { this.overflow = true; }
      if (newline < 0) break;
      this.finishLine(batch, true);
      if (batch.limited) return batch;
      from = newline + 1;
      this.start = this.offset + from;
      this.line++;
    }
    this.offset += bytes.length;
    if (eof) this.finishLine(batch, false);
    return batch;
  }

  private finishLine(batch: SearchBatch, newline: boolean): void {
    if (this.overflow) batch.skipped++;
    else {
      const length = newline && this.lineBytes[this.length - 1] === 13 ? this.length - 1 : this.length;
      let text: string;
      try { text = this.decoder.decode(this.lineBytes.subarray(0, length)); }
      catch { throw new Error(`Line ${this.line} is not valid UTF-8.`); }
      if (text.includes('\0')) throw new Error('The file contains binary data (NUL bytes).');
      let cursor = 0, byteCursor = this.start, textCursor = 0;
      const add = (index: number, value: string): boolean => {
        byteCursor += this.encoder.encode(text.slice(textCursor, index)).length;
        textCursor = index + value.length;
        const end = byteCursor + this.encoder.encode(value).length;
        batch.matches.push({ start: byteCursor, end, line: this.line, preview: text.slice(Math.max(0, index - 45), index + 120) });
        byteCursor = end;
        if (++this.count >= MAX_MATCHES) { batch.limited = true; return false; }
        return true;
      };
      if (this.regex) {
        for (const match of text.matchAll(this.regex)) if (!add(match.index, match[0])) break;
      } else {
        while ((cursor = text.indexOf(this.query, cursor)) >= 0) {
          if (!add(cursor, this.query)) break;
          cursor += this.query.length;
        }
      }
    }
    this.length = 0;
    this.overflow = false;
  }
}

/** Three lookahead bytes let a code point that starts in this page finish here. */
export function decodeLargePage(bytes: Uint8Array, pageLength: number, start: number): string {
  const continuation = (index: number) => (bytes[index] & 0xc0) === 0x80;
  let from = 0, end = pageLength;
  if (start > 0) while (from < Math.min(3, end) && continuation(from)) from++;
  while (end < Math.min(bytes.length, pageLength + 3) && continuation(end)) end++;
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: start !== 0 }).decode(bytes.subarray(from, end));
  if (text.includes('\0')) throw new Error('The file contains binary data (NUL bytes).');
  return text;
}
