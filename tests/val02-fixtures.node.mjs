import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtures } from '../scripts/validation/val02-fixtures.mjs';

test('creates deterministic, bounded fixtures and refuses an existing destination', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'val02-fixtures-'));
  const root = join(parent, 'new');
  try {
    const manifest = await createFixtures(root);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), manifest);
    assert.equal(manifest.files.length, 11);
    for (const entry of manifest.files) {
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of createReadStream(join(root, entry.path))) { hash.update(chunk); size += chunk.length; }
      assert.equal(size, entry.size, entry.path);
      assert.equal(hash.digest('hex'), entry.sha256, entry.path);
    }
    assert.equal(manifest.files.find((f) => f.path.endsWith('/20mib.txt')).size, 20 * 1024 * 1024);
    assert.equal(manifest.files.find((f) => f.path.endsWith('/20mib-plus-one.txt')).size, 20 * 1024 * 1024 + 1);
    assert.equal(manifest.files.find((f) => f.path.endsWith('/100mib.txt')).size, 100 * 1024 * 1024);
    assert.deepEqual(await readFile(join(root, 'workspace/utf16be.txt')), Buffer.from('feff0061006c007000680061000d000a0062006500740061000d000a', 'hex'));
    await writeFile(join(root, 'workspace/target.txt'), 'do not overwrite');
    await assert.rejects(createFixtures(root), { code: 'EEXIST' });
    assert.equal(await readFile(join(root, 'workspace/target.txt'), 'utf8'), 'do not overwrite');
  } finally { await rm(parent, { recursive: true, force: true }); }
});
