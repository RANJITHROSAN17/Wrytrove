import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-ignore .mjs script module
import { VAL01_FIXTURE_SIZES_MIB, VAL01_UNSUPPORTED_SIZES_MIB, writeVal01Fixtures } from '../scripts/val01-benchmark-fixtures.mjs';

describe('VAL-01 benchmark fixture generator', () => {
  it('generates deterministic SHA-256 fixtures and labels the 20 MiB boundary', () => {
    expect(VAL01_FIXTURE_SIZES_MIB).toEqual([1, 5, 20]);
    expect(VAL01_UNSUPPORTED_SIZES_MIB).toEqual([100, 500]);

    const dir = mkdtempSync(join(tmpdir(), 'val01-'));
    try {
      const m1 = writeVal01Fixtures(dir);
      const m2 = writeVal01Fixtures(dir);
      expect(m1).toHaveLength(3);
      expect(m1.every((entry: { supportedByWrytrove: boolean }) => entry.supportedByWrytrove)).toBe(true);
      expect(m1[0].sha256).toBe(m2[0].sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
