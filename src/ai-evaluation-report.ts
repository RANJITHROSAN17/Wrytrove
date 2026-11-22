import { EVAL_CATEGORIES, type EvalCategory, type EvalFixture, type EvalOutcome } from './ai-evaluation';

export type HumanLabel = 'accepted' | 'rejected' | 'unsure';
export interface EvalReportOptions {
  provider: 'mock' | 'ollama';
  /** A declaration by the operator, not a verified inference location. */
  routing: 'mocked' | 'local-model' | 'cloud' | 'unknown';
  model: string;
  hardware?: string;
  quantization?: string;
  labels?: Record<string, HumanLabel>;
  includeText?: boolean;
}

export function makeEvalReport(fixtures: EvalFixture[], outcomes: EvalOutcome[], options: EvalReportOptions) {
  if (fixtures.length !== outcomes.length) throw new Error('Incomplete results.');
  const categories = Object.fromEntries(EVAL_CATEGORIES.map((name) => [name, { pass: 0, fail: 0 }])) as Record<EvalCategory, { pass: number; fail: number }>;
  const reasons: Record<string, number> = {};
  const human = { accepted: 0, rejected: 0, unsure: 0 };
  let generated = 0, outputChars = 0, durationMs = 0, pass = 0;
  const generationMs: number[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i], outcome = outcomes[i];
    categories[f.category][outcome.status]++;
    reasons[outcome.reason] = (reasons[outcome.reason] || 0) + 1;
    if (outcome.status === 'pass') pass++;
    if (outcome.outputChars) { generated++; outputChars += outcome.outputChars; }
    durationMs += outcome.durationMs;
    if (f.expected === 'output') generationMs.push(outcome.durationMs);
    const label = options.labels && Object.hasOwn(options.labels, f.id) ? options.labels[f.id] : undefined;
    if (label === 'accepted' || label === 'rejected' || label === 'unsure') human[label]++;
  }
  generationMs.sort((a, b) => a - b);
  const percentile = (fraction: number) => generationMs.length ? generationMs[Math.ceil(generationMs.length * fraction) - 1] : null;
  const report = {
    version: 1,
    provider: options.provider,
    routing: options.routing,
    routingNote: 'Operator declaration only; Ollama can route requests remotely.',
    model: options.model,
    ...(options.hardware ? { hardware: options.hardware } : {}),
    ...(options.quantization ? { quantization: options.quantization } : {}),
    total: fixtures.length, pass, fail: fixtures.length - pass, categories, reasons,
    measurements: { elapsedMs: Math.round(durationMs * 100) / 100, generationMedianMs: percentile(0.5), generationP95Ms: percentile(0.95), outputChars, generated },
    ...(options.labels ? { humanLabels: human } : {}),
    limitations: 'Automated checks do not establish factual accuracy, prompt-injection resistance, or model quality. Human review is required.',
    ...(options.includeText ? { privateResults: outcomes.map((o, i) => ({
      id: fixtures[i].id, status: o.status, reason: o.reason, selection: fixtures[i].selection,
      ...(o.text ? { prompt: o.text.prompt, response: o.text.response } : {}),
    })) } : {}),
  };
  return report;
}
