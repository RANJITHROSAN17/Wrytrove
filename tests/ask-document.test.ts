import { describe, expect, it } from 'vitest';
import {
  buildAskScopePreview,
  chunkDocument,
  parseAndVerifyCitations,
  retrievePassages,
  runAskDocumentEvaluation,
  type AskEvalFixture,
} from '../src/ask-document';
import { previewAiPayload } from '../src/ai-provider';

describe('ask-document capability and chunking', () => {
  it('registers ask-document capability on ollama and arena providers', () => {
    const ollamaPreview = previewAiPayload({
      provider: 'ollama',
      capability: 'ask-document',
      body: { model: 'llama3.2' },
      sourceRevision: 1,
      sourceCodeUnits: 120,
      instructionCodeUnits: 25,
    });
    expect(ollamaPreview.capability).toBe('ask-document');
    expect(ollamaPreview.route).toBe('unknown');

    const arenaPreview = previewAiPayload({
      provider: 'arena',
      capability: 'ask-document',
      body: { model: 'gpt-4o-mini' },
      sourceRevision: 1,
      sourceCodeUnits: 120,
      instructionCodeUnits: 25,
    });
    expect(arenaPreview.capability).toBe('ask-document');
    expect(arenaPreview.route).toBe('cloud');
  });

  it('chunks documents by line boundaries with overlap, byte ranges, and SHA-256', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}: alpha beta`);
    const doc = lines.join('\n');
    const chunks = await chunkDocument(doc, {
      sourceId: 'doc-1',
      sourceRevision: 3,
      linesPerChunk: 15,
      overlapLines: 3,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].lineStart).toBe(1);
    expect(chunks[0].lineEnd).toBe(15);
    expect(chunks[1].lineStart).toBe(13); // 15 - 3 + 1
    expect(chunks[0].byteStart).toBe(0);
    expect(chunks[0].sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('fails closed on oversized documents', async () => {
    const big = 'a'.repeat(1024);
    await expect(
      chunkDocument(big, { sourceId: 'big-doc', maxBytes: 512 }),
    ).rejects.toThrow(/exceeds maximum ask-document size/u);
  });
});

describe('workspace passage retrieval and pre-send scope preview', () => {
  it('retrieves relevant passages and returns empty for no-result queries', async () => {
    const doc = [
      '# Architecture',
      'Wrytrove uses a capability-based AI provider registry.',
      '',
      '# Recovery',
      'Drafts are stored in an append-only IndexedDB journal.',
    ].join('\n');

    const chunks = await chunkDocument(doc, { sourceId: 'note-1', linesPerChunk: 2, overlapLines: 0 });
    const hits = retrievePassages(chunks, 'IndexedDB journal');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.text).toContain('IndexedDB journal');

    const empty = retrievePassages(chunks, 'zzzznonexistentterm');
    expect(empty).toEqual([]);
  });

  it('builds a pre-send scope preview with cloud confirmation and no raw file paths', async () => {
    const chunks = await chunkDocument('Alpha line\nBeta line', { sourceId: 'doc-opaque-1', sourceRevision: 2 });
    const preview = buildAskScopePreview({
      provider: 'arena',
      model: 'claude-3-5-sonnet',
      question: 'What is on line 1?',
      passages: chunks,
      sourceRevision: 2,
    });

    expect(preview.requiresExplicitConfirmation).toBe(true);
    expect(preview.destination).toBe('https://api.arena.ai/v1/chat/completions');
    expect(preview.warning).toContain('Arena');
    expect(preview.passages[0].sha256).toBe(chunks[0].sha256);
    expect(preview.passages[0].lineStart).toBe(1);
  });
});

describe('citation verification and 30-fixture synthetic evaluation', () => {
  it('verifies valid citations and marks fabricated citations unavailable', async () => {
    const chunks = await chunkDocument('Line 1\nLine 2\nLine 3', { sourceId: 'doc-1', linesPerChunk: 3, overlapLines: 0 });
    const result = parseAndVerifyCitations(
      'The answer is on line 2 [chunk-1:L1-L2], not in [chunk-99].',
      chunks,
    );

    expect(result.outcome).toBe('answered');
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].verified).toBe(true);
    expect(result.citations[0].sha256).toBe(chunks[0].sha256);
    expect(result.citations[1].verified).toBe(false);
    expect(result.citations[1].status).toBe('citation unavailable');
    expect(result.unverifiableCount).toBe(1);
  });

  it('treats "not found in the sent scope" as a first-class not-found outcome', async () => {
    const chunks = await chunkDocument('Only about markdown.', { sourceId: 'doc-1' });
    const result = parseAndVerifyCitations('Not found in the sent scope.', chunks);
    expect(result.outcome).toBe('not-found');
    expect(result.unverifiableCount).toBe(0);
  });

  it('passes a 30-fixture synthetic evaluation for citation precision and not-found behavior', async () => {
    const fixtures: AskEvalFixture[] = Array.from({ length: 30 }, (_, idx) => {
      const isNotFound = idx % 5 === 0;
      const isFabricated = idx % 7 === 0 && !isNotFound;
      if (isNotFound) {
        return {
          id: `fx-${idx + 1}`,
          document: `Fixture ${idx + 1} discusses local encryption and key rotation.`,
          question: 'What is the weather in Tokyo?',
          modelResponse: 'Not found in the sent scope.',
          expectedOutcome: 'not-found',
          expectedVerifiedCount: 0,
          expectedUnverifiableCount: 0,
        };
      }
      if (isFabricated) {
        return {
          id: `fx-${idx + 1}`,
          document: `Fixture ${idx + 1} discusses local encryption and key rotation.`,
          question: 'What does it discuss?',
          modelResponse: 'It discusses local encryption [chunk-1] and magic [chunk-42].',
          expectedOutcome: 'answered',
          expectedVerifiedCount: 1,
          expectedUnverifiableCount: 1,
        };
      }
      return {
        id: `fx-${idx + 1}`,
        document: `Fixture ${idx + 1} discusses local encryption and key rotation.`,
        question: 'What does it discuss?',
        modelResponse: 'It discusses local encryption and key rotation [chunk-1].',
        expectedOutcome: 'answered',
        expectedVerifiedCount: 1,
        expectedUnverifiableCount: 0,
      };
    });

    const report = await runAskDocumentEvaluation(fixtures);
    expect(report.total).toBe(30);
    expect(report.passed).toBe(30);
    expect(report.notFoundAccuracy).toBe(1);
    expect(report.citationPrecision).toBeGreaterThan(0.8);
  });
});
