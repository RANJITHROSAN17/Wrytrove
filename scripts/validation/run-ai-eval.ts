import { readFile, stat, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { evaluateFixture, validateEvalFixtures, type EvalProvider } from '../../src/ai-evaluation';
import { makeEvalReport, type HumanLabel } from '../../src/ai-evaluation-report';
import { makeOllamaEvalProvider } from '../../src/ai-eval-ollama';
import { syntheticFixtures } from './ai-eval-fixtures';

const help = `AI evaluation — synthetic fixtures by default\n\n  npm run ai:eval -- --mode mock\n  npm run ai:eval -- --mode ollama --model MODEL --routing local-model --acknowledge-ollama-routing\n\nOptions: --fixtures FILE (JSON array), --labels FILE (JSON object), --hardware TEXT,\n--quantization TEXT, --output NEW_FILE, --include-text (requires --output),\n--routing local-model|cloud|unknown, --help.\n\nThe Ollama endpoint is fixed to 127.0.0.1:11434. A local endpoint may route to\na remote provider. Results are aggregate only unless --include-text is used.\n`;

async function jsonFile(path: string): Promise<unknown> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 1_000_000) throw new Error('Input file is not a small regular file.');
  const data = await readFile(path);
  if (data.length > 1_000_000) throw new Error('Input file is too large.');
  return JSON.parse(data.toString('utf8')) as unknown;
}
function labelsFrom(value: unknown, ids: Set<string>): Record<string, HumanLabel> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid labels.');
  const result = Object.create(null) as Record<string, HumanLabel>;
  for (const [key, label] of Object.entries(value)) {
    if (!ids.has(key) || (label !== 'accepted' && label !== 'rejected' && label !== 'unsure')) throw new Error('Invalid labels.');
    result[key] = label;
  }
  return result;
}
function optionalLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9 ._+()-]{1,80}$/u.test(value)) throw new Error('Invalid metadata label.');
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean' }, mode: { type: 'string' }, model: { type: 'string' },
    fixtures: { type: 'string' }, labels: { type: 'string' }, output: { type: 'string' },
    hardware: { type: 'string' }, quantization: { type: 'string' }, routing: { type: 'string' },
    'include-text': { type: 'boolean' }, 'acknowledge-ollama-routing': { type: 'boolean' },
  } });
  if (values.help) { console.log(help); return; }
  const mode = values.mode ?? 'mock';
  if (mode !== 'mock' && mode !== 'ollama') throw new Error('Invalid mode.');
  if (values['include-text'] && !values.output) throw new Error('Text export requires an output file.');
  if (mode === 'ollama' && (!values.model || !values['acknowledge-ollama-routing'])) throw new Error('Ollama mode requires --model and --acknowledge-ollama-routing.');
  const model = values.model ?? 'synthetic-mock';
  if (!/^[a-zA-Z0-9._:/-]{1,120}$/u.test(model)) throw new Error('Invalid model name.');
  const routing = mode === 'mock' ? 'mocked' : values.routing ?? 'unknown';
  if (!['mocked', 'local-model', 'cloud', 'unknown'].includes(routing) || (mode === 'ollama' && routing === 'mocked') || (mode === 'mock' && values.routing)) throw new Error('Invalid routing declaration.');
  const fixtures = validateEvalFixtures(values.fixtures ? await jsonFile(values.fixtures) : syntheticFixtures);
  const labels = values.labels ? labelsFrom(await jsonFile(values.labels), new Set(fixtures.map((f) => f.id))) : undefined;
  const hardware = optionalLabel(values.hardware), quantization = optionalLabel(values.quantization);
  const provider: EvalProvider = mode === 'mock'
    ? async (_request, fixture) => new Response(JSON.stringify({ response: fixture.mockOutput ?? fixture.selection }))
    : makeOllamaEvalProvider();
  const outcomes = [];
  for (const fixture of fixtures) outcomes.push(await evaluateFixture(fixture, model, provider, values['include-text']));
  const report = makeEvalReport(fixtures, outcomes, {
    provider: mode, routing: routing as 'mocked' | 'local-model' | 'cloud' | 'unknown', model,
    hardware, quantization, labels, includeText: values['include-text'],
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) await writeFile(values.output, json, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(json);
  if (report.fail) process.exitCode = 1;
}

main().catch(() => {
  // Never echo paths, prompts, provider messages, or private input in errors.
  console.error('AI evaluation could not run. Check the documented options and input files.');
  process.exitCode = 2;
});
