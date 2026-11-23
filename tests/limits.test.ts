import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import limits from '../limits.json';
import { MAX_FILE_BYTES, MAX_FILE_MIB } from '../src/encoding';

/**
 * The 20 MiB budget exists in two compilation units, so it is authored once in `limits.json` and
 * checked here: this test fails the moment either side hardcodes a different number again.
 */
describe('shared file-size limit', () => {
  it('derives the TypeScript budget from limits.json', () => {
    expect(MAX_FILE_BYTES).toBe(limits.maxFileBytes);
    expect(MAX_FILE_MIB).toBe(20);
    expect(MAX_FILE_BYTES).toBe(MAX_FILE_MIB * 1024 * 1024);
  });

  it('keeps the Rust limit equal to limits.json', () => {
    const rust = readFileSync('src-tauri/src/lib.rs', 'utf8');
    const declared = /const MAX_FILE_BYTES: usize = ([^;]+);/u.exec(rust);
    expect(declared, 'MAX_FILE_BYTES must stay declared in lib.rs').not.toBeNull();
    // Evaluate the literal Rust expression (`20 * 1024 * 1024`).
    const expression = declared![1].replace(/_/gu, '');
    expect(/^[\d\s*+]+$/u.test(expression)).toBe(true);
    const value = expression.split('*').reduce((total, part) => total * Number(part.trim()), 1);
    expect(value).toBe(limits.maxFileBytes);
  });

  it('keeps a single authored value and no stale frontend copy', () => {
    expect(Object.keys(limits)).toEqual(['maxFileBytes']);
    for (const file of ['src/encoding.ts', 'src/platform.ts', 'src/main.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/20 MiB/u);
    }
  });
});
