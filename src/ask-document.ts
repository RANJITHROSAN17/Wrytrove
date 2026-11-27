import { AI_PROVIDERS, previewAiPayload, type AiPayloadPreview, type AiProvider, type AiRouteState } from './ai-provider';

export const ASK_MAX_DOCUMENT_BYTES = 512 * 1024; // 512 KiB
export const ASK_MAX_CHUNKS = 200;
export const ASK_DEFAULT_CHUNK_LINES = 24;
export const ASK_DEFAULT_OVERLAP_LINES = 4;
export const ASK_MAX_PASSAGES = 8;

const encoder = new TextEncoder();

export interface DocumentChunk {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceRevision: number | null;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly sha256: string;
  readonly text: string;
}

export interface ChunkOptions {
  readonly sourceId: string;
  readonly sourceRevision?: number | null;
  readonly linesPerChunk?: number;
  readonly overlapLines?: number;
  readonly maxBytes?: number;
  readonly maxChunks?: number;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = encoder.encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function chunkDocument(content: string, options: ChunkOptions): Promise<DocumentChunk[]> {
  const maxBytes = options.maxBytes ?? ASK_MAX_DOCUMENT_BYTES;
  const maxChunks = options.maxChunks ?? ASK_MAX_CHUNKS;
  const linesPerChunk = Math.max(1, options.linesPerChunk ?? ASK_DEFAULT_CHUNK_LINES);
  const overlapLines = Math.max(0, Math.min(linesPerChunk - 1, options.overlapLines ?? ASK_DEFAULT_OVERLAP_LINES));
  const sourceRevision = options.sourceRevision ?? null;

  const totalBytes = encoder.encode(content).length;
  if (totalBytes > maxBytes) {
    throw new Error(`Document exceeds maximum ask-document size (${totalBytes} > ${maxBytes} bytes).`);
  }
  if (!content.trim()) return [];

  const rawLines = content.split('\n');
  const lineByteStarts: number[] = new Array(rawLines.length);
  const lineByteEnds: number[] = new Array(rawLines.length);
  let offset = 0;
  for (let i = 0; i < rawLines.length; i += 1) {
    lineByteStarts[i] = offset;
    const lineBytes = encoder.encode(rawLines[i]).length;
    lineByteEnds[i] = offset + lineBytes;
    offset = lineByteEnds[i] + (i < rawLines.length - 1 ? 1 : 0); // '\n'
  }

  const chunks: DocumentChunk[] = [];
  const step = Math.max(1, linesPerChunk - overlapLines);
  for (let startIdx = 0; startIdx < rawLines.length; startIdx += step) {
    const endIdx = Math.min(rawLines.length - 1, startIdx + linesPerChunk - 1);
    const text = rawLines.slice(startIdx, endIdx + 1).join('\n');
    const sha256 = await sha256Hex(text);
    chunks.push({
      chunkId: `chunk-${chunks.length + 1}`,
      sourceId: options.sourceId,
      sourceRevision,
      lineStart: startIdx + 1,
      lineEnd: endIdx + 1,
      byteStart: lineByteStarts[startIdx],
      byteEnd: lineByteEnds[endIdx],
      sha256,
      text,
    });
    if (chunks.length > maxChunks) {
      throw new Error(`Document exceeds maximum chunk count (${maxChunks}).`);
    }
    if (endIdx === rawLines.length - 1) break;
  }
  return chunks;
}

export interface ScoredPassage {
  readonly chunk: DocumentChunk;
  readonly score: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * Bounded lexical inverted-index / TF-IDF-style scorer over document chunks.
 * Returns at most `limit` passages with score > 0, sorted by score descending.
 */
export function retrievePassages(
  chunks: readonly DocumentChunk[],
  query: string,
  limit = ASK_MAX_PASSAGES,
): ScoredPassage[] {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0 || chunks.length === 0 || limit <= 0) return [];

  const docFreq = new Map<string, number>();
  const chunkTokens = chunks.map((chunk) => {
    const tokens = tokenize(chunk.text);
    const unique = new Set(tokens);
    for (const term of unique) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
    return tokens;
  });

  const n = chunks.length;
  const scored: ScoredPassage[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const tokens = chunkTokens[i];
    if (tokens.length === 0) continue;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const count = tf.get(term) ?? 0;
      if (count === 0) continue;
      const df = docFreq.get(term) ?? 1;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (count / (count + 1.2)) * idf;
    }
    if (score > 0) scored.push({ chunk: chunks[i], score });
  }

  scored.sort((a, b) => b.score - a.score || a.chunk.lineStart - b.chunk.lineStart);
  return scored.slice(0, limit);
}

export interface AskScopePreview {
  readonly provider: AiProvider;
  readonly model: string;
  readonly destination: string;
  readonly route: AiRouteState;
  readonly warning: string;
  readonly requiresExplicitConfirmation: boolean;
  readonly passages: readonly Pick<DocumentChunk, 'chunkId' | 'sourceId' | 'lineStart' | 'lineEnd' | 'sha256'>[];
  readonly totalCharacters: number;
  readonly payloadPreview: AiPayloadPreview;
}

export function buildAskScopePreview(input: {
  provider: AiProvider;
  model: string;
  question: string;
  passages: readonly DocumentChunk[];
  sourceRevision: number | null;
}): AskScopePreview {
  if (!input.question.trim()) throw new Error('Enter a question before asking.');
  if (input.passages.length === 0) throw new Error('No passages selected for ask-document.');

  const descriptor = AI_PROVIDERS[input.provider];
  const promptBody = {
    model: input.model,
    question: input.question,
    passages: input.passages.map((p) => ({
      chunkId: p.chunkId,
      lineStart: p.lineStart,
      lineEnd: p.lineEnd,
      sha256: p.sha256,
      text: p.text,
    })),
  };
  const totalCharacters = input.passages.reduce((sum, p) => sum + p.text.length, 0);
  const payloadPreview = previewAiPayload({
    provider: input.provider,
    capability: 'ask-document',
    body: promptBody,
    sourceRevision: input.sourceRevision,
    sourceCodeUnits: totalCharacters,
    instructionCodeUnits: input.question.length,
  });

  return {
    provider: input.provider,
    model: input.model,
    destination: descriptor.endpoint,
    route: descriptor.route,
    warning: descriptor.warning,
    requiresExplicitConfirmation: input.provider === 'arena' || descriptor.route === 'cloud',
    passages: input.passages.map((p) => ({
      chunkId: p.chunkId,
      sourceId: p.sourceId,
      lineStart: p.lineStart,
      lineEnd: p.lineEnd,
      sha256: p.sha256,
    })),
    totalCharacters,
    payloadPreview,
  };
}

export interface VerifiedCitation {
  readonly chunkId: string;
  readonly verified: boolean;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly sha256: string | null;
  readonly status: 'verified' | 'citation unavailable';
}

export interface AskAnswerResult {
  readonly outcome: 'answered' | 'not-found';
  readonly answer: string;
  readonly citations: readonly VerifiedCitation[];
  readonly unverifiableCount: number;
}

const NOT_FOUND_PATTERNS = [
  /\bi don['’]t know\b/iu,
  /\bnot found in the sent scope\b/iu,
  /\bnot mentioned in the provided\b/iu,
  /\bcannot be determined from the provided\b/iu,
];

/**
 * Parses structured citation markers like `[chunk-1]` or `[chunk-2:L10-L20]`
 * and verifies every cited chunkId (and optional line range) against the exact sent chunks.
 */
export function parseAndVerifyCitations(
  rawResponse: string,
  sentChunks: readonly DocumentChunk[],
): AskAnswerResult {
  const answer = rawResponse.trim();
  const byId = new Map(sentChunks.map((c) => [c.chunkId, c]));
  const citations: VerifiedCitation[] = [];
  const seen = new Set<string>();

  const pattern = /\[(chunk-\d+)(?::L(\d+)-L(\d+))?\]/gu;
  for (const match of answer.matchAll(pattern)) {
    const chunkId = match[1];
    const reqStart = match[2] ? Number(match[2]) : null;
    const reqEnd = match[3] ? Number(match[3]) : null;
    const key = `${chunkId}:${reqStart ?? ''}:${reqEnd ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const chunk = byId.get(chunkId);
    const rangeValid =
      chunk !== undefined &&
      (reqStart === null || (reqStart >= chunk.lineStart && reqEnd !== null && reqEnd <= chunk.lineEnd && reqStart <= reqEnd));

    if (chunk && rangeValid) {
      citations.push({
        chunkId,
        verified: true,
        lineStart: reqStart ?? chunk.lineStart,
        lineEnd: reqEnd ?? chunk.lineEnd,
        sha256: chunk.sha256,
        status: 'verified',
      });
    } else {
      citations.push({
        chunkId,
        verified: false,
        lineStart: null,
        lineEnd: null,
        sha256: null,
        status: 'citation unavailable',
      });
    }
  }

  const isNotFound = NOT_FOUND_PATTERNS.some((re) => re.test(answer));
  const unverifiableCount = citations.filter((c) => !c.verified).length;
  return {
    outcome: isNotFound ? 'not-found' : 'answered',
    answer,
    citations,
    unverifiableCount,
  };
}

export interface AskEvalFixture {
  readonly id: string;
  readonly document: string;
  readonly question: string;
  readonly modelResponse: string;
  readonly expectedOutcome: 'answered' | 'not-found';
  readonly expectedVerifiedCount: number;
  readonly expectedUnverifiableCount: number;
}

export interface AskEvalReport {
  readonly total: number;
  readonly passed: number;
  readonly citationPrecision: number;
  readonly notFoundAccuracy: number;
}

export async function runAskDocumentEvaluation(fixtures: readonly AskEvalFixture[]): Promise<AskEvalReport> {
  let passed = 0;
  let totalVerified = 0;
  let totalCitations = 0;
  let notFoundTotal = 0;
  let notFoundCorrect = 0;

  for (const fx of fixtures) {
    const chunks = await chunkDocument(fx.document, { sourceId: fx.id });
    const retrieved = retrievePassages(chunks, fx.question, ASK_MAX_PASSAGES).map((s) => s.chunk);
    const sent = retrieved.length > 0 ? retrieved : chunks.slice(0, 2);
    const result = parseAndVerifyCitations(fx.modelResponse, sent);

    const verifiedCount = result.citations.filter((c) => c.verified).length;
    totalVerified += verifiedCount;
    totalCitations += result.citations.length;

    if (fx.expectedOutcome === 'not-found') {
      notFoundTotal += 1;
      if (result.outcome === 'not-found') notFoundCorrect += 1;
    }

    if (
      result.outcome === fx.expectedOutcome &&
      verifiedCount === fx.expectedVerifiedCount &&
      result.unverifiableCount === fx.expectedUnverifiableCount
    ) {
      passed += 1;
    }
  }

  return {
    total: fixtures.length,
    passed,
    citationPrecision: totalCitations === 0 ? 1 : totalVerified / totalCitations,
    notFoundAccuracy: notFoundTotal === 0 ? 1 : notFoundCorrect / notFoundTotal,
  };
}
