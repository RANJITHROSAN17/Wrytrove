// Real files and the production search core. This is not a Tauri/WebView2 benchmark.
import { open, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';

const MIB = 1024 ** 2;
const sizes = [100, 500];
const filename = (mib) => `wrytrove-${mib}mib.log`;

async function fixture(dir, mib) {
  // 128-byte CRLF lines and a unique match in the final line; no giant buffers.
  const block = Buffer.alloc(MIB);
  const line = Buffer.alloc(128, 32);
  line.write('2026-11-19 INFO synthetic UTF-8 🌱 log entry');
  line.write('\r\n', line.length - 2);
  for (let i = 0; i < block.length; i += line.length) line.copy(block, i);
  const file = await open(join(dir, filename(mib)), 'wx');
  try {
    for (let i = 0; i < mib; i++) {
      if (i === mib - 1) block.write('WRYTROVE_LAST_MATCH', block.length - line.length);
      let written = 0;
      while (written < block.length) {
        const result = await file.write(block, written, block.length - written);
        if (result.bytesWritten === 0) throw new Error('Fixture write made no progress.');
        written += result.bytesWritten;
      }
    }
  } finally { await file.close(); }
}

async function productionCore() {
  const { default: ts } = await import('typescript');
  const source = readFileSync(new URL('../src/large-file-search.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

async function readRange(file, offset, length) {
  const bytes = new Uint8Array(length);
  let total = 0;
  while (total < length) {
    const { bytesRead } = await file.read(bytes, total, length - total, offset + total);
    if (!bytesRead) throw new Error('Fixture shortened during read.');
    total += bytesRead;
  }
  return bytes;
}

function request(worker, data, transfer = []) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit); };
    const onMessage = (value) => { cleanup(); resolve(value); };
    const onError = (error) => { cleanup(); reject(error); };
    const onExit = (code) => onError(new Error(`Search worker exited (${code}).`));
    worker.once('message', onMessage).once('error', onError).once('exit', onExit);
    worker.postMessage(data, transfer);
  });
}

async function measure(path, mib) {
  const core = await productionCore();
  const { decodeLargePage, SEARCH_CHUNK } = await import(core);
  const rssBeforeKiB = Math.round(process.memoryUsage.rss() / 1024);
  const start = performance.now();
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const page = await readRange(file, 0, 32768 + 3);
    if (!decodeLargePage(page, 32768, 0).includes('synthetic')) throw new Error('Unexpected fixture text.');
    const firstWindowMs = performance.now() - start;
    const scanStart = performance.now();
    const worker = new Worker(new URL(import.meta.url), { workerData: core });
    let matches = [];
    try {
      for (let offset = 0; offset < size; offset += SEARCH_CHUNK) {
        const bytes = await readRange(file, offset, Math.min(SEARCH_CHUNK, size - offset));
        const batch = await request(worker, { bytes, eof: offset + bytes.length === size }, [bytes.buffer]);
        if (batch.skipped || batch.limited) throw new Error('Unexpected incomplete scan.');
        matches.push(...batch.matches);
      }
    } finally { await worker.terminate(); }
    const searchMs = performance.now() - scanStart;
    if (matches.length !== 1 || matches[0].start !== size - 128) throw new Error('Unexpected match count or range.');
    const cancelled = new Worker(new URL(import.meta.url), { workerData: core });
    let jsWorkerCancelMs;
    try {
      const bytes = await readRange(file, 0, SEARCH_CHUNK);
      await request(cancelled, { bytes, eof: false }, [bytes.buffer]);
      const cancelStart = performance.now();
      await cancelled.terminate();
      jsWorkerCancelMs = performance.now() - cancelStart;
    } finally { await cancelled.terminate(); }
    return { mib, firstWindowMs, searchMs, jsWorkerCancelMs, rssBeforeKiB, peakRssKiB: process.resourceUsage().maxRSS };
  } finally { await file.close(); }
}

if (parentPort) {
  const { LargeFileSearch } = await import(workerData);
  const search = new LargeFileSearch('WRYTROVE_LAST_MATCH', false);
  parentPort.on('message', ({ bytes, eof }) => parentPort.postMessage(search.push(bytes, eof)));
} else if (process.argv[2] === '--measure') {
  console.log(JSON.stringify(await measure(process.argv[3], Number(process.argv[4]))));
} else if (process.argv[2] === '--fixtures' && process.argv[3]) {
  const dir = process.argv[3];
  await mkdir(dir, { recursive: true });
  for (const mib of sizes) await fixture(dir, mib);
  console.log(`Created ${sizes.map(filename).join(' and ')} in ${dir}.`);
} else if (process.argv.length === 2) {
  const dir = await mkdtemp(join(tmpdir(), 'wrytrove-large-bench-'));
  try {
    const measurements = [];
    for (const mib of sizes) {
      await fixture(dir, mib);
      const command = [fileURLToPath(import.meta.url), '--measure', join(dir, filename(mib)), String(mib)];
      measurements.push(JSON.parse(execFileSync(process.execPath, command, { encoding: 'utf8' })));
    }
    console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, measurements }, null, 2));
  } finally { await rm(dir, { recursive: true, force: true }); }
} else { throw new Error('Usage: benchmark-large-file.mjs [--fixtures DIRECTORY]'); }
