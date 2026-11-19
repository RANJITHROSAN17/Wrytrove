import { describe, expect, it } from 'vitest';
import { decodeLargePage, LargeFileSearch, MAX_LINE, MAX_MATCHES } from '../src/large-file-search';

const encode = (text: string) => new TextEncoder().encode(text);

describe('bounded large-file search', () => {
  it('maps UTF-8 byte ranges and CRLF lines across arbitrary chunk boundaries', () => {
    const search = new LargeFileSearch('🌱end', false);
    const bytes = encode('é🌱end\r\n🌱end\nlast');
    const matches = [...bytes].flatMap((value, index) => search.push(Uint8Array.of(value), index === bytes.length - 1).matches);
    expect(matches.map(({ start, end, line }) => [start, end, line])).toEqual([[2, 9, 1], [11, 18, 2]]);
  });

  it('handles zero-length Unicode regex matches and checks the final unterminated line', () => {
    const search = new LargeFileSearch('(?=🌱)|end$', true);
    expect(search.push(encode('🌱end'), true).matches.map(({ start, end }) => [start, end])).toEqual([[0, 0], [4, 7]]);
  });

  it('skips oversize lines without retaining their tails or losing following coordinates', () => {
    const search = new LargeFileSearch('hit', false);
    expect(search.push(encode('a'.repeat(MAX_LINE)), false)).toEqual({ matches: [], skipped: 0, limited: false });
    const batch = search.push(encode('hit\nhit'), true);
    expect(batch.skipped).toBe(1);
    expect(batch.matches).toEqual([{ start: MAX_LINE + 4, end: MAX_LINE + 7, line: 2, preview: 'hit' }]);
  });

  it('caps results and never reports the scan as complete when it hits the cap', () => {
    const batch = new LargeFileSearch('a', false).push(encode('a'.repeat(MAX_MATCHES + 500)), true);
    expect(batch.matches).toHaveLength(MAX_MATCHES);
    expect(batch.limited).toBe(true);
  });

  it('rejects invalid patterns and marks malformed UTF-8 and NUL bytes as errors', () => {
    expect(() => new LargeFileSearch('[', true)).toThrow();
    expect(() => new LargeFileSearch('a', false).push(Uint8Array.of(255), true)).toThrow('not valid UTF-8');
    expect(() => new LargeFileSearch('a', false).push(encode('a\0'), true)).toThrow('binary data');
  });
});

describe('large-file page decoding', () => {
  it('keeps split code points exactly once across consecutive pages', () => {
    const bytes = encode('a🌱b');
    for (let split = 1; split < bytes.length; split++) {
      const first = decodeLargePage(bytes.subarray(0, split + 3), split, 0);
      const second = decodeLargePage(bytes.subarray(split), bytes.length - split, split);
      expect(first + second).toBe('a🌱b');
    }
  });

  it('fails on binary data and truncated sequences at EOF', () => {
    expect(() => decodeLargePage(Uint8Array.of(0), 1, 0)).toThrow('binary data');
    expect(() => decodeLargePage(Uint8Array.of(0xe2, 0x82), 2, 0)).toThrow();
  });
});
