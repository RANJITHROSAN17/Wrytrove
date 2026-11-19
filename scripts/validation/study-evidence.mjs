#!/usr/bin/env node
// VAL-05 evidence helper. This tool never contacts a network, never reads a real user document,
// and never stores a participant name, document text, file path, prompt, recording or identifier.
//
//   node scripts/validation/study-evidence.mjs check [study-root]
//   node scripts/validation/study-evidence.mjs fixtures [study-root] --write
//   node scripts/validation/study-evidence.mjs aggregate [observations.csv] [--out report.md]
//
// The checked-in study kit contains protocol documents, synthetic fixtures, checksums, a header-only
// observation template and a controlled codebook. Local coded rows belong in the ignored records
// directory. Only an aggregate, human-reviewed report should ever be attached to an issue.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_STUDY_ROOT = fileURLToPath(new URL('../../research/val-05/', import.meta.url));
const PROTOCOL_PATH = fileURLToPath(new URL('../../docs/VALIDATION-STUDY-VAL-05.md', import.meta.url));
export const MIN_SESSIONS = 5;

export const PERSONA_CODES = [
  'writer',
  'developer',
  'note_taker',
  'privacy_sensitive',
  'assistive_tech',
];
export const TASK_IDS = Array.from({ length: 12 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`);
export const DISPLAY_CODES = [
  'scale_100',
  'scale_150',
  'scale_200',
  'forced_colors',
  'min_window',
  'not_applicable',
];
export const REQUIRED_DISPLAY_CODES = DISPLAY_CODES.filter((code) => code !== 'not_applicable');
export const AT_CODES = [
  'none',
  'keyboard_only',
  'narrator',
  'nvda',
  'narrator_keyboard_only',
  'nvda_keyboard_only',
];
export const REQUIRED_AT_CODES = ['keyboard_only', 'narrator', 'nvda'];
export const COMPLETION_CODES = [
  'independent',
  'with_prompt',
  'with_facilitator_help',
  'failed',
  'not_attempted',
  'withdrawn',
];
export const COMPREHENSION_CODES = ['clear', 'minor_uncertainty', 'confused', 'incorrect_model', 'not_asked'];
export const SEVERITY_CODES = ['none', 'low', 'medium', 'high', 'blocker'];
export const FINDING_CODES = [
  'none',
  'FOCUS_TRAP',
  'UNLABELED_CONTROL',
  'STATE_COLOR_ONLY',
  'LAYOUT_CLIPPED',
  'STATUS_NOT_ANNOUNCED',
  'SAVED_UNSAVED_CONFUSION',
  'EXTERNAL_CHANGE_CONFUSION',
  'SEARCH_SOURCE_UNCLEAR',
  'REVIEW_UNCLEAR',
  'NOTE_NAVIGATION_UNCLEAR',
  'PREVIEW_UNCLEAR',
  'AI_DESTINATION_UNCLEAR',
  'AI_CONSENT_UNCLEAR',
  'RECOVERY_PRIVACY_UNCLEAR',
  'INSTALL_UNINSTALL_UNCLEAR',
  'SETTINGS_UNCLEAR',
  'PERFORMANCE_HESITATION',
  'OTHER_REDACTED',
];
export const OBSERVATION_COLUMNS = [
  'session_id',
  'persona_code',
  'task_id',
  'display_code',
  'at_code',
  'completion_code',
  'help_count',
  'error_count',
  'hesitation_seconds',
  'duration_seconds',
  'comprehension_code',
  'severity_code',
  'finding_code',
];

const ENUMS = {
  persona_code: PERSONA_CODES,
  task_id: TASK_IDS,
  display_code: DISPLAY_CODES,
  at_code: AT_CODES,
  completion_code: COMPLETION_CODES,
  comprehension_code: COMPREHENSION_CODES,
  severity_code: SEVERITY_CODES,
  finding_code: FINDING_CODES,
};
const NUMERIC_LIMITS = {
  help_count: 99,
  error_count: 99,
  hesitation_seconds: 3600,
  duration_seconds: 3600,
};
const SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3, blocker: 4 };
const DECISION_META = [
  { id: 'D1', title: 'Search source labels', route: '#50' },
  { id: 'D2', title: 'Review-first compare and undo', route: '#52' },
  { id: 'D3', title: 'AI destination and consent wording', route: '#54, #68' },
  { id: 'D4', title: 'Accessibility release gate', route: '#56, #62' },
  { id: 'D5', title: 'No default product analytics', route: '#69' },
  { id: 'D6', title: 'Portable files and low-ceremony onboarding', route: '#46' },
];
const MEDIA_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.aiff',
  '.mp4', '.mov', '.webm', '.mkv', '.avi',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf']);
const TEXT_EXTENSIONS = new Set(['.md', '.csv', '.json', '.txt', '.ts', '.mjs', '.py', '.yml', '.yaml']);
const TEXT_RULES = [
  { id: 'email_like', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { id: 'url_like', pattern: /\b(?:https?:\/\/|www\.)\S+/i },
  {
    id: 'absolute_path',
    pattern: /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\/(?:home|Users|root|tmp|var|mnt)\/|\\\\[A-Za-z0-9._$-]+\\)/,
  },
  { id: 'phone_like', pattern: /(?:\+\d[\d\s().-]{8,}\d|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b|\b\d{10}\b)/ },
  {
    id: 'secret_like',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{12,}/,
  },
  {
    id: 'credential_assignment',
    pattern: /\b(?:api[_-]?key|password|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}/i,
  },
  { id: 'embedded_media', pattern: /data:(?:audio|video)\//i },
];
const FORBIDDEN_RECORD_FIELD = /participant_name|full_name|home_address|document_text|prompt_text|voice_note|file_path|quote_text|verbatim_quote/i;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const attempted = (rows) => rows.filter((row) => row.completion_code !== 'not_attempted' && row.completion_code !== 'withdrawn');

function independentRate(rows) {
  const candidates = attempted(rows);
  if (!candidates.length) return null;
  const independent = candidates.filter((row) => row.completion_code === 'independent').length;
  return Math.round((independent / candidates.length) * 100);
}

function clearRate(rows) {
  const candidates = rows.filter((row) => row.comprehension_code !== 'not_asked');
  if (!candidates.length) return null;
  const clear = candidates.filter((row) => row.comprehension_code === 'clear').length;
  return Math.round((clear / candidates.length) * 100);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function maxSeverity(rows) {
  return rows.reduce(
    (worst, row) => SEVERITY_RANK[row.severity_code] > SEVERITY_RANK[worst] ? row.severity_code : worst,
    'none',
  );
}

function findingCounts(rows) {
  const codes = rows.filter((row) => row.finding_code !== 'none').map((row) => row.finding_code);
  return Object.entries(countBy(codes))
    .map(([code, count]) => ({ code, count, max_severity: maxSeverity(rows.filter((row) => row.finding_code === code)) }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function atCodeMatches(row, code) {
  return row.at_code === code || row.at_code.includes(code);
}

export function parseCsv(text) {
  const cleaned = text.replace(/^\uFEFF/, '').trimEnd();
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) throw new Error('Observation CSV is empty; copy observation-template.csv.');
  if (lines.some((line) => line.includes('"'))) throw new Error('Observation CSV must not contain quoted fields or free text.');
  const header = lines[0].split(',');
  if (header.join(',') !== OBSERVATION_COLUMNS.join(',')) {
    throw new Error('Observation CSV header does not match observation-template.csv.');
  }
  return lines.slice(1).map((line, index) => {
    const fields = line.split(',');
    if (fields.length !== header.length) throw new Error(`Row ${index + 2} has the wrong number of fields.`);
    if (fields.some((field) => field !== field.trim() || field.includes('\t'))) {
      throw new Error(`Row ${index + 2} contains malformed or free-text fields.`);
    }
    return Object.fromEntries(header.map((column, columnIndex) => [column, fields[columnIndex]]));
  });
}

export function validateObservationRows(rows) {
  const errors = [];
  const expectedKeys = [...OBSERVATION_COLUMNS].sort().join(',');
  rows.forEach((row, index) => {
    const label = `Row ${index + 2}`;
    if (Object.keys(row).sort().join(',') !== expectedKeys) {
      errors.push(`${label} has missing or unexpected columns.`);
      return;
    }
    if (!/^S(0[1-9]|[1-9]\d)$/.test(row.session_id)) errors.push(`${label} has an invalid session code.`);
    for (const [column, allowed] of Object.entries(ENUMS)) {
      if (!allowed.includes(row[column])) errors.push(`${label} has an invalid ${column}.`);
    }
    for (const [column, limit] of Object.entries(NUMERIC_LIMITS)) {
      const value = row[column];
      if (!/^\d+$/.test(value) || Number(value) > limit) errors.push(`${label} has an invalid ${column}.`);
    }
    const hasFinding = row.finding_code !== 'none';
    const hasSeverity = row.severity_code !== 'none';
    if (hasFinding !== hasSeverity) errors.push(`${label} must pair a finding code with a severity code.`);
  });
  return { ok: errors.length === 0, errors };
}

export function evaluateEvidenceCoverage(rows) {
  const sessionCount = new Set(rows.map((row) => row.session_id)).size;
  const blockers = [];
  if (sessionCount < MIN_SESSIONS) {
    blockers.push(`At least ${MIN_SESSIONS} distinct sessions are required; ${sessionCount} present.`);
  }
  for (const code of PERSONA_CODES) {
    if (!rows.some((row) => row.persona_code === code)) blockers.push(`Persona ${code} has no observations.`);
  }
  for (const code of REQUIRED_DISPLAY_CODES) {
    if (!rows.some((row) => row.display_code === code)) blockers.push(`Display condition ${code} has no observations.`);
  }
  for (const code of REQUIRED_AT_CODES) {
    if (!rows.some((row) => atCodeMatches(row, code))) blockers.push(`Assistive condition ${code} has no observations.`);
  }
  for (const id of TASK_IDS) {
    if (!rows.some((row) => row.task_id === id)) blockers.push(`Task ${id} has no observations.`);
  }
  return {
    sufficient: blockers.length === 0,
    blockers,
    session_count: sessionCount,
    persona_codes: [...new Set(rows.map((row) => row.persona_code))].sort(),
    display_codes: [...new Set(rows.map((row) => row.display_code))].sort(),
    assistive_codes: [...new Set(rows.map((row) => row.at_code))].sort(),
    task_ids: [...new Set(rows.map((row) => row.task_id))].sort(),
  };
}

function personaSummary(code, rows) {
  const personaRows = rows.filter((row) => row.persona_code === code);
  const numbers = (column) => personaRows.map((row) => Number(row[column]));
  return {
    persona_code: code,
    session_count: new Set(personaRows.map((row) => row.session_id)).size,
    task_count: personaRows.length,
    independent_completion_rate: independentRate(personaRows),
    median_duration_seconds: median(numbers('duration_seconds')),
    median_error_count: median(numbers('error_count')),
    median_help_count: median(numbers('help_count')),
    error_total: numbers('error_count').reduce((sum, value) => sum + value, 0),
    hesitation_seconds_total: numbers('hesitation_seconds').reduce((sum, value) => sum + value, 0),
    completion: countBy(personaRows.map((row) => row.completion_code)),
    comprehension: countBy(personaRows.map((row) => row.comprehension_code)),
    findings: findingCounts(personaRows),
    qualitative_finding_codes: findingCounts(personaRows).map((finding) => finding.code),
  };
}

function conditionSummary(codes, rows, selector) {
  return codes.map((code) => {
    const matching = rows.filter((row) => selector(row, code));
    return {
      code,
      task_count: matching.length,
      independent_completion_rate: independentRate(matching),
      error_total: matching.reduce((sum, row) => sum + Number(row.error_count), 0),
      finding_codes: findingCounts(matching).map((finding) => finding.code),
    };
  });
}

function accessibilityFindings(rows) {
  const relevant = rows.filter((row) => row.finding_code !== 'none' && (
    REQUIRED_DISPLAY_CODES.includes(row.display_code) || row.at_code !== 'none'
  ));
  const groups = new Map();
  for (const row of relevant) {
    const key = [row.display_code, row.at_code, row.task_id, row.finding_code].join('|');
    const group = groups.get(key) ?? {
      display_code: row.display_code,
      at_code: row.at_code,
      task_id: row.task_id,
      finding_code: row.finding_code,
      count: 0,
      max_severity: 'none',
      route: '#56',
    };
    group.count += 1;
    if (SEVERITY_RANK[row.severity_code] > SEVERITY_RANK[group.max_severity]) group.max_severity = row.severity_code;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (
    a.display_code + a.at_code + a.task_id + a.finding_code
  ).localeCompare(b.display_code + b.at_code + b.task_id + b.finding_code));
}

function pendingDecisions(blockers) {
  return DECISION_META.map((decision) => ({
    ...decision,
    outcome: 'insufficient_evidence',
    basis: `No product decision is made yet: ${blockers.length} evidence coverage blocker(s).`,
  }));
}

function recommendDecisions(rows) {
  const decisions = [];
  const search = rows.filter((row) => row.task_id === 'T04');
  const searchConfusion = search.filter((row) => (
    ['confused', 'incorrect_model'].includes(row.comprehension_code) || row.finding_code === 'SEARCH_SOURCE_UNCLEAR'
  )).length;
  const searchRate = independentRate(search) ?? 0;
  decisions.push({
    ...DECISION_META[0],
    outcome: searchConfusion >= 2 || searchRate < 80 ? 'change' : 'confirm',
    basis: `Search task independent completion ${searchRate}%; ${searchConfusion} source-confusion signal(s).`,
  });

  const review = rows.filter((row) => row.task_id === 'T05');
  const reviewUnclear = review.filter((row) => row.finding_code === 'REVIEW_UNCLEAR' || row.completion_code === 'failed').length;
  const reviewRate = independentRate(review) ?? 0;
  decisions.push({
    ...DECISION_META[1],
    outcome: reviewUnclear >= 2 || reviewRate < 80 ? 'change' : 'confirm',
    basis: `Review task independent completion ${reviewRate}%; ${reviewUnclear} unclear or failed signal(s).`,
  });

  const consent = rows.filter((row) => row.task_id === 'T08');
  const consentUnclear = consent.filter((row) => (
    ['AI_DESTINATION_UNCLEAR', 'AI_CONSENT_UNCLEAR'].includes(row.finding_code)
    || ['confused', 'incorrect_model'].includes(row.comprehension_code)
  )).length;
  const consentRate = independentRate(consent) ?? 0;
  decisions.push({
    ...DECISION_META[2],
    outcome: consentUnclear >= 2 || consentRate < 80 ? 'change' : 'confirm',
    basis: `Consent task independent completion ${consentRate}%; ${consentUnclear} comprehension signal(s).`,
  });

  const a11y = rows.filter((row) => ['T10', 'T11', 'T12'].includes(row.task_id)
    || row.at_code !== 'none'
    || REQUIRED_DISPLAY_CODES.includes(row.display_code));
  const namedBarriers = ['FOCUS_TRAP', 'UNLABELED_CONTROL', 'STATE_COLOR_ONLY', 'LAYOUT_CLIPPED', 'STATUS_NOT_ANNOUNCED'];
  const a11yBlockers = a11y.filter((row) => ['high', 'blocker'].includes(row.severity_code)
    || namedBarriers.includes(row.finding_code)).length;
  const a11yRate = independentRate(a11y) ?? 0;
  const a11yClear = clearRate(a11y) ?? 0;
  decisions.push({
    ...DECISION_META[3],
    outcome: a11yBlockers ? 'change' : a11yRate >= 80 && a11yClear >= 80 ? 'confirm' : 'insufficient_evidence',
    basis: a11yBlockers
      ? `${a11yBlockers} high-severity or named accessibility barrier(s) require a release decision.`
      : `Accessibility tasks independent completion ${a11yRate}%; clear comprehension ${a11yClear}%. This is not conformance certification.`,
  });

  const core = rows.filter((row) => ['T01', 'T02', 'T03', 'T06', 'T07', 'T09'].includes(row.task_id));
  const coreRate = independentRate(core) ?? 0;
  decisions.push({
    ...DECISION_META[4],
    outcome: coreRate >= 80 && !core.some((row) => row.finding_code === 'OTHER_REDACTED') ? 'reject' : 'insufficient_evidence',
    basis: `Core tasks independent completion ${coreRate}%; telemetry was not needed to complete the protocol.`,
  });

  const install = rows.filter((row) => row.task_id === 'T01');
  const installRate = independentRate(install) ?? 0;
  decisions.push({
    ...DECISION_META[5],
    outcome: installRate >= 80 && !install.some((row) => row.finding_code === 'INSTALL_UNINSTALL_UNCLEAR') ? 'confirm' : 'change',
    basis: `First-run and uninstall task independent completion ${installRate}%; portable synthetic file remained in scope.`,
  });
  return decisions;
}

export function summarizeObservations(rows, options = {}) {
  const validation = validateObservationRows(rows);
  if (!validation.ok) throw new Error(`Observation rows are invalid: ${validation.errors.join(' ')}`);
  const evidence = evaluateEvidenceCoverage(rows);
  return {
    version: 1,
    status: rows.length ? 'coded observations only' : 'no observations',
    session_count: evidence.session_count,
    evidence,
    personas: PERSONA_CODES.map((code) => personaSummary(code, rows)),
    conditions: {
      display: conditionSummary(DISPLAY_CODES, rows, (row, code) => row.display_code === code),
      assistive: conditionSummary(AT_CODES, rows, (row, code) => atCodeMatches(row, code)),
    },
    accessibility_findings: accessibilityFindings(rows),
    decisions: evidence.sufficient ? recommendDecisions(rows) : pendingDecisions(evidence.blockers),
    pilot_exception: options.pilotException ?? null,
    privacy_note: 'Aggregate counts and controlled codes only; no raw participant artifacts are included.',
  };
}

function formatPercent(value) {
  return value === null || value === undefined ? 'not measured' : `${value}%`;
}

function formatNumber(value) {
  return value === null || value === undefined ? 'not measured' : String(value);
}

export function renderSummaryMarkdown(summary) {
  const lines = [
    '# VAL-05 anonymized study summary',
    '',
    `Status: ${summary.status}. Sessions: ${summary.session_count}. Evidence sufficient for decisions: ${summary.evidence.sufficient ? 'yes' : 'no'}.`,
    '',
    'No raw participant document, path, prompt, voice recording or personal identifier is included. This aggregate is not proof of accessibility conformance or statistical significance.',
    '',
    '## Evidence coverage',
    '',
    ...(summary.evidence.blockers.length
      ? summary.evidence.blockers.map((blocker) => `- ${blocker}`)
      : ['- All protocol coverage gates are present.']),
    '',
    '## Core outcomes by persona',
    '',
    '| Persona | Sessions | Tasks | Independent success | Median time (s) | Median errors | Comprehension | Coded findings |',
    '|---|---:|---:|---:|---:|---:|---|---|',
  ];
  for (const persona of summary.personas) {
    const comprehension = Object.entries(persona.comprehension).map(([code, count]) => `${code}: ${count}`).join(', ') || 'none';
    const findings = persona.qualitative_finding_codes.join(', ') || 'none';
    lines.push(`| ${persona.persona_code} | ${persona.session_count} | ${persona.task_count} | ${formatPercent(persona.independent_completion_rate)} | ${formatNumber(persona.median_duration_seconds)} | ${formatNumber(persona.median_error_count)} | ${comprehension} | ${findings} |`);
  }
  lines.push(
    '',
    '## Conditions',
    '',
    '| Kind | Condition | Tasks | Independent success | Errors | Coded findings |',
    '|---|---|---:|---:|---:|---|',
  );
  for (const [kind, rows] of [['display', summary.conditions.display], ['assistive', summary.conditions.assistive]]) {
    for (const row of rows) {
      lines.push(`| ${kind} | ${row.code} | ${row.task_count} | ${formatPercent(row.independent_completion_rate)} | ${row.error_total} | ${row.finding_codes.join(', ') || 'none'} |`);
    }
  }
  lines.push(
    '',
    '## Pre-registered product decisions',
    '',
    '| ID | Decision | Outcome | Evidence basis | Route |',
    '|---|---|---|---|---|',
  );
  for (const decision of summary.decisions) {
    lines.push(`| ${decision.id} | ${decision.title} | ${decision.outcome} | ${decision.basis} | ${decision.route} |`);
  }
  lines.push(
    '',
    '## Accessibility appendix for #56',
    '',
    '| Display | Assistive technology | Task | Finding code | Count | Max severity | Route |',
    '|---|---|---|---|---:|---|---|',
  );
  if (!summary.accessibility_findings.length) lines.push('| _none_ | _none_ | _none_ | _none_ | 0 | none | #56 |');
  for (const finding of summary.accessibility_findings) {
    lines.push(`| ${finding.display_code} | ${finding.at_code} | ${finding.task_id} | ${finding.finding_code} | ${finding.count} | ${finding.max_severity} | ${finding.route} |`);
  }
  lines.push(
    '',
    'Attach this aggregate and the appendix to #69 and #56 respectively after human review. Do not attach local records or recordings. If a pilot smaller than five sessions is proposed, the pilot-size record must be approved before recruiting.',
    '',
  );
  return lines.join('\n');
}

export function scanText(text, relativePath = 'unknown', fixtureSnippets = []) {
  const findings = [];
  const path = relativePath.split(sep).join('/');
  const push = (rule) => findings.push({ file: path, rule });
  const extension = extname(path).toLowerCase();
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\') || /(^|\/)\.\.(\/|$)/.test(path)) {
    push('unsafe_relative_path');
  }
  if (MEDIA_EXTENSIONS.has(extension)) push('audio_or_video_artifact');
  if (IMAGE_EXTENSIONS.has(extension)) push('image_artifact');
  if (text.length > 200000) push('oversized_text_artifact');
  for (const rule of TEXT_RULES) if (rule.pattern.test(text)) push(rule.id);
  if (path.startsWith('records/')) {
    if (FORBIDDEN_RECORD_FIELD.test(text)) push('forbidden_record_field');
    if (fixtureSnippets.some((snippet) => snippet && text.includes(snippet))) push('fixture_document_text');
  }
  return findings;
}

async function listFiles(root) {
  const output = [];
  async function walk(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(byName);
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = join(directory, entry.name);
      const path = relative(root, full).split(sep).join('/');
      if (entry.isSymbolicLink()) {
        output.push({ path, type: 'symlink' });
      } else if (entry.isDirectory()) {
        output.push({ path, type: 'dir' });
        await walk(full);
      } else if (entry.isFile()) {
        output.push({ path, type: 'file', full });
      } else {
        output.push({ path, type: 'other' });
      }
    }
  }
  await walk(root);
  return output;
}

export async function verifyFixtureManifest(root = DEFAULT_STUDY_ROOT) {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, 'fixtures', 'manifest.json'), 'utf8'));
  } catch {
    return { ok: false, errors: ['Fixture manifest is missing or unreadable.'], count: 0 };
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    return { ok: false, errors: ['Fixture manifest has an unsupported shape.'], count: 0 };
  }
  const declared = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const actual = new Map();
  const entries = await listFiles(join(root, 'fixtures'));
  for (const entry of entries) {
    if (entry.type !== 'file' || entry.path === 'manifest.json') continue;
    const bytes = await readFile(entry.full);
    actual.set(entry.path, { path: entry.path, size: bytes.length, sha256: sha256(bytes) });
  }
  for (const [path, entry] of [...actual.entries()].sort()) {
    const expected = declared.get(path);
    if (!expected) errors.push(`Missing manifest entry: ${path}`);
    else if (expected.size !== entry.size || expected.sha256 !== entry.sha256) errors.push(`Fixture checksum mismatch: ${path}`);
  }
  for (const path of declared.keys()) if (!actual.has(path)) errors.push(`Stale manifest entry: ${path}`);
  return { ok: errors.length === 0, errors, count: actual.size };
}

export async function writeFixtureManifest(root = DEFAULT_STUDY_ROOT) {
  const fixtureRoot = join(root, 'fixtures');
  await mkdir(fixtureRoot, { recursive: true });
  const entries = await listFiles(fixtureRoot);
  const files = [];
  for (const entry of entries) {
    if (entry.type !== 'file' || entry.path === 'manifest.json') continue;
    const bytes = await readFile(entry.full);
    files.push({ path: entry.path, size: bytes.length, sha256: sha256(bytes) });
  }
  files.sort(byPath);
  const manifest = {
    version: 1,
    generated_by: 'scripts/validation/study-evidence.mjs fixtures --write',
    files,
  };
  await writeFile(join(fixtureRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return verifyFixtureManifest(root);
}

async function loadFixtureSnippets(root) {
  const snippets = [];
  const entries = await listFiles(join(root, 'fixtures'));
  for (const entry of entries) {
    if (entry.type !== 'file' || entry.path === 'manifest.json') continue;
    if (!TEXT_EXTENSIONS.has(extname(entry.path).toLowerCase())) continue;
    const text = await readFile(entry.full, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length >= 32) snippets.push(trimmed);
    }
  }
  return [...new Set(snippets)];
}

export async function collectPrivacyFindings(root = DEFAULT_STUDY_ROOT) {
  const findings = [];
  const snippets = await loadFixtureSnippets(root);
  const entries = await listFiles(root);
  let filesScanned = 0;
  for (const entry of entries) {
    if (entry.type === 'symlink') {
      findings.push({ file: entry.path, rule: 'symlink_artifact' });
      continue;
    }
    if (entry.type !== 'file') continue;
    filesScanned += 1;
    const extension = extname(entry.path).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) findings.push({ file: entry.path, rule: 'unexpected_file_type' });
    const bytes = await readFile(entry.full);
    if (bytes.includes(0)) {
      findings.push({ file: entry.path, rule: 'binary_artifact' });
      continue;
    }
    const text = bytes.toString('utf8');
    findings.push(...scanText(text, entry.path, snippets));
    if (entry.path.startsWith('records/') && !['.md', '.csv', '.json'].includes(extension)) {
      findings.push({ file: entry.path, rule: 'unexpected_record_file' });
    }
    if (entry.path.startsWith('records/') && extension === '.csv') {
      try {
        const validation = validateObservationRows(parseCsv(text));
        for (const error of validation.errors) findings.push({ file: entry.path, rule: 'observation_schema', detail: error });
      } catch (error) {
        findings.push({ file: entry.path, rule: 'observation_schema', detail: error.message });
      }
    }
  }
  try {
    const protocolText = await readFile(PROTOCOL_PATH, 'utf8');
    filesScanned += 1;
    findings.push(...scanText(protocolText, 'docs/VALIDATION-STUDY-VAL-05.md', snippets));
  } catch {
    // A packaged copy without the protocol document is still checked for its study root.
  }
  return { findings, files_scanned: filesScanned };
}

export async function checkStudy(root = DEFAULT_STUDY_ROOT) {
  const fixture = await verifyFixtureManifest(root);
  const privacy = await collectPrivacyFindings(root);
  const findings = [
    ...privacy.findings,
    ...fixture.errors.map((error) => ({ file: 'fixtures/manifest.json', rule: 'fixture_manifest', detail: error })),
  ];
  return {
    ok: findings.length === 0,
    files_scanned: privacy.files_scanned,
    fixture_count: fixture.count,
    findings,
  };
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === 'check' || command === 'fixtures') {
    const root = resolve(args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_STUDY_ROOT);
    if (command === 'fixtures' && args.includes('--write')) {
      const result = await writeFixtureManifest(root);
      console.log(`Wrote manifest for ${result.count} synthetic fixture file(s).`);
      return result.ok ? 0 : 1;
    }
    const result = command === 'check' ? await checkStudy(root) : await verifyFixtureManifest(root);
    if (result.ok) {
      console.log(command === 'check'
        ? `VAL-05 study kit clean: ${result.files_scanned} file(s) scanned, ${result.fixture_count} fixture(s) verified.`
        : `Fixture manifest verified: ${result.count} file(s).`);
      return 0;
    }
    console.error(JSON.stringify(result.findings ?? result.errors, null, 2));
    return 1;
  }
  if (command === 'aggregate') {
    const outIndex = args.indexOf('--out');
    const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
    if (outIndex >= 0 && !outPath) throw new Error('The --out option needs a report path.');
    const positional = args.filter((arg, index) => arg !== '--out' && (outIndex < 0 || index !== outIndex + 1));
    const csvPath = positional[0] ? resolve(positional[0]) : join(DEFAULT_STUDY_ROOT, 'records', 'observations.csv');
    const text = await readFile(csvPath, 'utf8');
    const rows = parseCsv(text);
    const validation = validateObservationRows(rows);
    if (!validation.ok) throw new Error(`Observation rows are invalid: ${validation.errors.join(' ')}`);
    const snippets = await loadFixtureSnippets(DEFAULT_STUDY_ROOT);
    const scanPath = relative(DEFAULT_STUDY_ROOT, csvPath).split(sep).join('/');
    const scanFindings = scanText(text, scanPath, snippets);
    if (scanFindings.length) throw new Error(`Privacy guard found: ${[...new Set(scanFindings.map((finding) => finding.rule))].join(', ')}.`);
    const fixture = await verifyFixtureManifest(DEFAULT_STUDY_ROOT);
    if (!fixture.ok) throw new Error('Fixture manifest mismatch; regenerate it before aggregating.');
    const markdown = renderSummaryMarkdown(summarizeObservations(rows));
    if (outPath) await writeFile(outPath, markdown);
    console.log(markdown);
    return 0;
  }
  console.error([
    'usage:',
    '  node scripts/validation/study-evidence.mjs check [study-root]',
    '  node scripts/validation/study-evidence.mjs fixtures [study-root] --write',
    '  node scripts/validation/study-evidence.mjs aggregate [observations.csv] [--out report.md]',
  ].join('\n'));
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
