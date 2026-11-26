#!/usr/bin/env node
// Create a NEW disposable VAL-02 tree. Never writes to an existing destination.
import { createHash } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {string} root */
export async function createFixtures(root) {
  // mkdir without recursive deliberately fails if the destination already exists.
  await mkdir(root);
  await mkdir(join(root, 'workspace'));
  await mkdir(join(root, 'outside'));
  /** @type {{ path: string, size: number, sha256: string }[]} */
  const records = [];
  /** @param {string} name @param {Iterable<Buffer>} chunks */
  async function fixture(name, chunks) {
    const file = await open(join(root, name), 'wx');
    const hash = createHash('sha256');
    let size = 0;
    try {
      for (const chunk of chunks) {
        // FileHandle.writeFile handles partial writes. Chunks are bounded to 1 MiB.
        await file.writeFile(chunk);
        hash.update(chunk);
        size += chunk.length;
      }
    } finally { await file.close(); }
    records.push({ path: name.replaceAll('\\', '/'), size, sha256: hash.digest('hex') });
  }
  /** @param {string} s */
  const bytes = (s) => Buffer.from(s, 'utf8');
  const text = 'alpha\r\nbeta\r\n';
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.from(le).swap16();
  await fixture('workspace/utf8.txt', [bytes('alpha\nbeta\n')]);
  await fixture('workspace/utf8-bom.txt', [Buffer.from([0xef, 0xbb, 0xbf]), bytes(text)]);
  await fixture('workspace/utf16le.txt', [Buffer.from([0xff, 0xfe]), le]);
  await fixture('workspace/utf16be.txt', [Buffer.from([0xfe, 0xff]), be]);
  await fixture('workspace/crlf.txt', [bytes(text)]);
  await fixture('workspace/mixed.txt', [bytes('alpha\r\nbeta\ngamma\r\n')]);
  await fixture('workspace/target.txt', [bytes('original synthetic content\n')]);
  await fixture('outside/canary.txt', [bytes('outside synthetic canary\n')]);
  const block = Buffer.alloc(1024 * 1024, 0x61);
  /** @param {number} size @returns {Generator<Buffer>} */
  function* large(size) {
    while (size > 0) {
      const count = Math.min(size, block.length);
      yield block.subarray(0, count);
      size -= count;
    }
  }
  for (const [name, size] of /** @type {[string, number][]} */ ([['20mib.txt', 20 * 1024 * 1024], ['20mib-plus-one.txt', 20 * 1024 * 1024 + 1], ['100mib.txt', 100 * 1024 * 1024]])) {
    await fixture(`workspace/${name}`, large(size));
  }
  const manifest = { version: 1, algorithm: 'sha256', files: records };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('usage: node scripts/validation/val02-fixtures.mjs <new-directory>');
    process.exitCode = 2;
  } else {
    createFixtures(process.argv[2]).then(() => console.log('Created synthetic fixtures.'), (error) => {
      console.error(error.message);
      console.error('Destination may be incomplete; inspect it before removing it manually.');
      process.exitCode = 1;
    });
  }
}
