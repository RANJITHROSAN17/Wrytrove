import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STUDY_ROOT,
  OBSERVATION_COLUMNS,
  PERSONA_CODES,
  REQUIRED_DISPLAY_CODES,
  TASK_IDS,
  checkStudy,
  parseCsv,
  renderSummaryMarkdown,
  scanText,
  summarizeObservations,
  validateObservationRows,
  verifyFixtureManifest,
  writeFixtureManifest,
} from '../scripts/validation/study-evidence.mjs';

type Row = Record<string, string>;
const header = OBSERVATION_COLUMNS.join(',');
const fixtureLine = 'VAL05-SYNTHETIC-LONG-LINE-FOR-GUARD-TEST';

function makeRow(overrides: Row = {}): Row {
  return {
    session_id: 'S01',
    persona_code: 'writer',
    task_id: 'T02',
    display_code: 'scale_100',
    at_code: 'none',
    completion_code: 'independent',
    help_count: '0',
    error_count: '0',
    hesitation_seconds: '0',
    duration_seconds: '30',
    comprehension_code: 'clear',
    severity_code: 'none',
    finding_code: 'none',
    ...overrides,
  };
}

function csv(rows: Row[]): string {
  return [header, ...rows.map((row) => OBSERVATION_COLUMNS.map((column) => row[column] ?? '').join(','))].join('\n');
}

function fullSample(): Row[] {
  const rows: Row[] = [];
  PERSONA_CODES.forEach((persona, personaIndex) => {
    TASK_IDS.forEach((task, taskIndex) => {
      let atCode = 'none';
      if (task === 'T10') atCode = 'keyboard_only';
      if (task === 'T11') atCode = personaIndex % 2 === 0 ? 'narrator' : 'nvda';
      if (task === 'T12') atCode = personaIndex % 2 === 0 ? 'nvda' : 'narrator';
      rows.push(makeRow({
        session_id: `S0${personaIndex + 1}`,
        persona_code: persona,
        task_id: task,
        display_code: REQUIRED_DISPLAY_CODES[taskIndex % REQUIRED_DISPLAY_CODES.length],
        at_code: atCode,
        duration_seconds: String(20 + taskIndex),
      }));
    });
  });
  return rows;
}

describe('VAL-05 observation schema and privacy guard', () => {
  it('accepts the committed study kit and generated fixture manifest', async () => {
    const result = await checkStudy(DEFAULT_STUDY_ROOT);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.fixture_count).toBeGreaterThan(20);
  });

  it('rejects prohibited text and media artifacts without echoing matched values', () => {
    expect(scanText('safe', 'records/observations.csv')).toEqual([]);
    const rules = (text: string, path = 'records/x.csv', snippets: string[] = []) => scanText(text, path, snippets).map((finding) => finding.rule);
    expect(rules('person@example.invalid')).toContain('email_like');
    expect(rules('https://example.invalid')).toContain('url_like');
    expect(rules('C:\\Users\\case\\note.txt')).toContain('absolute_path');
    expect(rules('call 123-456-7890 now')).toContain('phone_like');
    expect(rules('sk-abcdefghijklmnop')).toContain('secret_like');
    expect(rules('password = EXAMPLE-ONLY-VALUE')).toContain('credential_assignment');
    expect(rules('participant_name,value')).toContain('forbidden_record_field');
    expect(rules(fixtureLine, 'records/x.csv', [fixtureLine])).toContain('fixture_document_text');
    expect(rules('x', 'records/voice.mp3')).toContain('audio_or_video_artifact');
    expect(rules('x', '../records/x.csv')).toContain('unsafe_relative_path');
    expect(scanText('person@example.invalid')[0].detail).toBeUndefined();
  });

  it('validates the exact coded schema and refuses free text or invalid values', () => {
    const rows = parseCsv(csv([makeRow()]));
    expect(rows).toHaveLength(1);
    expect(validateObservationRows(rows).ok).toBe(true);
    expect(parseCsv(csv([]))).toEqual([]);
    expect(validateObservationRows([{ ...rows[0], quote: 'free text' }]).errors.join(' ')).toContain('unexpected columns');
    expect(validateObservationRows([{ ...rows[0], persona_code: 'unknown' }]).ok).toBe(false);
    expect(validateObservationRows([{ ...rows[0], duration_seconds: '-1' }]).ok).toBe(false);
    expect(validateObservationRows([{ ...rows[0], finding_code: 'FOCUS_TRAP' }]).ok).toBe(false);
    expect(() => parseCsv(`${header}\n"free,text"`)).toThrow(/free text/);
  });

  it('keeps decisions pending when evidence coverage is incomplete', () => {
    const summary = summarizeObservations([]);
    expect(summary.evidence.sufficient).toBe(false);
    expect(summary.decisions.every((decision) => decision.outcome === 'insufficient_evidence')).toBe(true);
    expect(renderSummaryMarkdown(summary)).toContain('Evidence sufficient for decisions: no');
    expect(renderSummaryMarkdown(summary)).not.toContain('S01');
  });

  it('summarizes by persona and produces at least three evidence-backed recommendations for a complete coded sample', () => {
    const rows = parseCsv(csv(fullSample()));
    expect(validateObservationRows(rows).ok).toBe(true);
    const summary = summarizeObservations(rows);
    expect(summary.evidence.sufficient).toBe(true);
    expect(summary.personas).toHaveLength(5);
    expect(summary.personas.every((persona) => persona.independent_completion_rate === 100)).toBe(true);
    expect(summary.decisions.filter((decision) => decision.outcome !== 'insufficient_evidence').length).toBeGreaterThanOrEqual(3);
    expect(summary.decisions.find((decision) => decision.id === 'D5')?.outcome).toBe('reject');
    const markdown = renderSummaryMarkdown(summary);
    expect(markdown).toContain('Core outcomes by persona');
    expect(markdown).toContain('Accessibility appendix for #56');
    expect(markdown).not.toContain('S01');
  });

  it('routes high-severity assistive-technology findings to #56 and changes the accessibility decision', () => {
    const rows = parseCsv(csv(fullSample()));
    rows[0] = {
      ...rows[0],
      task_id: 'T10',
      display_code: 'scale_200',
      at_code: 'keyboard_only',
      finding_code: 'FOCUS_TRAP',
      severity_code: 'high',
    };
    const summary = summarizeObservations(rows);
    expect(summary.evidence.sufficient).toBe(true);
    expect(summary.accessibility_findings.some((finding) => finding.finding_code === 'FOCUS_TRAP' && finding.route === '#56')).toBe(true);
    expect(summary.decisions.find((decision) => decision.id === 'D4')?.outcome).toBe('change');
    expect(renderSummaryMarkdown(summary)).toContain('FOCUS_TRAP');
  });
});

describe('VAL-05 fixture manifest guard', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'val05-study-'));
    await mkdir(join(root, 'fixtures'), { recursive: true });
    await mkdir(join(root, 'records'), { recursive: true });
    await writeFile(join(root, 'fixtures', 'chapter.md'), `${fixtureLine}\n`);
    const manifest = await writeFixtureManifest(root);
    expect(manifest.ok).toBe(true);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('passes a clean temporary kit and detects a changed fixture', async () => {
    expect((await checkStudy(root)).ok).toBe(true);
    await writeFile(join(root, 'fixtures', 'chapter.md'), 'changed\n');
    const result = await verifyFixtureManifest(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('checksum mismatch');
  });

  it('detects pasted fixture text and malformed records in the local ignored directory', async () => {
    await writeFile(join(root, 'records', 'note.md'), fixtureLine);
    const pasted = await checkStudy(root);
    expect(pasted.ok).toBe(false);
    expect(pasted.findings.map((finding) => finding.rule)).toContain('fixture_document_text');

    await writeFile(join(root, 'records', 'bad.csv'), 'person@example.invalid\n');
    const result = await checkStudy(root);
    expect(result.findings.map((finding) => finding.rule)).toContain('email_like');
    expect(result.findings.map((finding) => finding.rule)).toContain('observation_schema');
  });
});
