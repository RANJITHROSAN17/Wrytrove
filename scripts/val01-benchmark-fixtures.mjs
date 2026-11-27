import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VAL01_FIXTURE_SIZES_MIB = [1, 5, 20];
export const VAL01_UNSUPPORTED_SIZES_MIB = [100, 500];
export const VAL01_WORKSPACE_FILE_COUNT = 5000;

export function generateSyntheticMarkdown(targetBytes) {
  const line = '## Section — synthetic benchmark line with **markdown** and `code`.\n';
  const lineBytes = Buffer.byteLength(line, 'utf8');
  const repeats = Math.max(1, Math.floor(targetBytes / lineBytes));
  return line.repeat(repeats);
}

export function sha256Of(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function writeVal01Fixtures(outDir) {
  mkdirSync(outDir, { recursive: true });
  const manifest = [];
  for (const mib of VAL01_FIXTURE_SIZES_MIB) {
    const content = generateSyntheticMarkdown(mib * 1024 * 1024);
    const file = join(outDir, `fixture-${mib}mib.md`);
    writeFileSync(file, content, 'utf8');
    manifest.push({
      name: `fixture-${mib}mib.md`,
      sizeMiB: mib,
      supportedByWrytrove: true,
      sha256: sha256Of(content),
    });
  }
  return manifest;
}
