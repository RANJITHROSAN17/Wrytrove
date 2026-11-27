import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const START = '<!-- BENCHMARK_RESULTS:START -->';
const END = '<!-- BENCHMARK_RESULTS:END -->';

const raw = execSync('node scripts/benchmark-large-file.mjs', { encoding: 'utf8' });
const data = JSON.parse(raw);

const rows = data.measurements.map((m) => {
  const first = m.firstWindowMs.toFixed(2);
  const search = m.searchMs.toFixed(2);
  const cancel = m.jsWorkerCancelMs.toFixed(2);
  const rss = m.peakRssKiB.toLocaleString('en-US');
  return `| ${m.mib} MiB | ${first} ms | ${search} ms | ${cancel} ms | ${rss} KiB |`;
});

const block = [
  START,
  `Measured large-file streaming & cancellation (\`node scripts/benchmark-large-file.mjs\`, Node ${data.node}, ${data.platform} ${data.arch}):`,
  '',
  '| File Size | First Window | Streaming Search | Worker Cancel | Peak RSS |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...rows,
  END,
].join('\n');

const readme = readFileSync('README.md', 'utf8');
const startIdx = readme.indexOf(START);
const endIdx = readme.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  throw new Error('README.md is missing BENCHMARK_RESULTS markers.');
}

const next = readme.slice(0, startIdx) + block + readme.slice(endIdx + END.length);
if (next !== readme) {
  writeFileSync('README.md', next, 'utf8');
  console.log('Updated README.md benchmark results.');
} else {
  console.log('README.md benchmark results unchanged.');
}
