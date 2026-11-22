import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, AiAttemptLedger, AiSessionConsent, previewAiPayload } from '../src/ai-provider';
import { buildActionRequest } from '../src/ai-actions';
import { buildArenaRequest } from '../src/arena';
import { buildCompletionRequest } from '../src/ai';

describe('shared AI request descriptions', () => {
  it('counts the exact UTF-8 serialized JSON body and labels routes conservatively', () => {
    const action = buildActionRequest({ selection: '🦋 café', instruction: 'Say “yes”', model: 'model-one', action: 'custom' });
    const local = previewAiPayload({ provider: 'ollama', capability: 'selection-edit', body: action, sourceRevision: 7, sourceCodeUnits: 7, instructionCodeUnits: 9 });
    expect(local.bodyBytes).toBe(new TextEncoder().encode(JSON.stringify(action)).length);
    expect(local.bodyBytes).toBeGreaterThan(JSON.stringify(action).length);
    expect(local.destination).toBe('http://127.0.0.1:11434/api/generate');
    expect(local.route).toBe('unknown'); expect(local.sourceRevision).toBe(7);
    expect(AI_PROVIDERS.ollama.warning).toMatch(/cloud/);
    const arena = buildArenaRequest({ key: 'test-secret', model: 'model-two', instruction: 'Question?', selection: '', mode: 'ask' });
    const cloud = previewAiPayload({ provider: 'arena', capability: 'arena-ask', body: arena, sourceRevision: null, sourceCodeUnits: 0, instructionCodeUnits: 9 });
    expect(cloud.destination).toBe('https://api.arena.ai/v1/chat/completions');
    expect(cloud.route).toBe('cloud');
    expect(cloud.bodyBytes).toBe(new TextEncoder().encode(JSON.stringify(arena)).length);
    expect(JSON.stringify(cloud)).not.toContain('test-secret');
    const inline = buildCompletionRequest('hello', 5, 'model-one');
    expect(previewAiPayload({ provider: 'ollama', capability: 'inline-completion', body: inline, sourceRevision: 1, sourceCodeUnits: 5, instructionCodeUnits: 0 }).bodyBytes)
      .toBe(new TextEncoder().encode(JSON.stringify(inline)).length);
  });
  it('rejects wrong capability, malformed model, revision and size rather than guessing', () => {
    const valid = { provider: 'ollama' as const, capability: 'selection-edit' as const, body: { model: 'valid' }, sourceRevision: 1, sourceCodeUnits: 1, instructionCodeUnits: 0 };
    expect(() => previewAiPayload({ ...valid, capability: 'arena-ask' })).toThrow(/capability/);
    expect(() => previewAiPayload({ ...valid, body: { model: 'bad model' } })).toThrow(/model/);
    expect(() => previewAiPayload({ ...valid, sourceRevision: -1 })).toThrow(/revision/);
    expect(() => previewAiPayload({ ...valid, sourceCodeUnits: Infinity })).toThrow(/size/);
  });
});

describe('session-only consent and redacted diagnostics', () => {
  it('separates providers, models and capabilities and clears every approval on change', () => {
    const consent = new AiSessionConsent();
    consent.grant('ollama', 'model-a', 'selection-edit');
    expect(consent.has('ollama', 'model-a', 'selection-edit')).toBe(true);
    expect(consent.has('ollama', 'model-a', 'selection-answer')).toBe(false);
    expect(consent.has('ollama', 'model-b', 'selection-edit')).toBe(false);
    expect(consent.has('arena', 'model-a', 'arena-edit')).toBe(false);
    consent.grant('ollama', 'model-a', 'inline-completion'); consent.clear();
    expect(consent.has('ollama', 'model-a', 'selection-edit')).toBe(false);
    expect(consent.has('ollama', 'model-a', 'inline-completion')).toBe(false);
  });
  it('retains only bounded safe metadata, not even attacker-controlled model IDs or extra fields', () => {
    const ledger = new AiAttemptLedger(2);
    const body = buildArenaRequest({ key: 'PRIVATEKEY', model: 'private/path', instruction: 'PRIVATEPROMPT', selection: 'PRIVATESELECTION', mode: 'ask' });
    const preview = previewAiPayload({ provider: 'arena', capability: 'arena-ask', body, sourceRevision: 93, sourceCodeUnits: 16, instructionCodeUnits: 13 });
    ledger.record(preview); ledger.record(preview); ledger.record(preview);
    const diagnostics = ledger.diagnostics();
    for (const forbidden of ['PRIVATEKEY', 'PRIVATEPROMPT', 'PRIVATESELECTION', 'private/path', 'sourceRevision']) expect(diagnostics).not.toContain(forbidden);
    const parsed = JSON.parse(diagnostics) as { dropped: number; attempts: unknown[] };
    expect(parsed.dropped).toBe(1); expect(parsed.attempts).toHaveLength(2);
    expect(parsed.attempts[0]).toEqual({ provider: 'arena', capability: 'arena-ask', route: 'cloud', bodyBytes: preview.bodyBytes, sourceCodeUnits: 16, instructionCodeUnits: 13 });
    expect(diagnostics).toContain('not proof of delivery');
    ledger.clear(); expect(JSON.parse(ledger.diagnostics())).toMatchObject({ dropped: 0, attempts: [] });
  });
});
