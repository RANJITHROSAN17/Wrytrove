import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { desktop } from './platform';
import { boundedJson } from './bounded-json';
import { AI_PROVIDERS, OLLAMA_API_BASE } from './ai-provider';
import { buildActionRequest, cleanActionOutput, getAiAction, type AiActionId } from './ai-actions';

export const DEFAULT_MODEL = 'qwen2.5-coder:1.5b';
export const AI_CONTEXT_BEFORE = 3500;
export const AI_CONTEXT_AFTER = 1200;
export const MAX_OLLAMA_RESPONSE_BYTES = 262_144;
const MAX_OLLAMA_ERROR_BYTES = 8_192;

/**
 * Ollama requests must leave this machine with no Origin header.
 *
 * `tauri-plugin-http` stamps every request with the webview's origin, which on a
 * Windows release build is `https://tauri.localhost`. Ollama's default CORS
 * allow-list covers `tauri://*` (the Linux/macOS origin) but not that Windows
 * origin, so an installed build was rejected with HTTP 403 before the request ever
 * reached the API — while a dev build, served from `http://localhost:<port>`, was
 * allowed. Sending an explicitly empty Origin makes the plugin drop the header
 * entirely; that needs the plugin's `unsafe-headers` feature (see src-tauri/Cargo.toml).
 * The header is also simply not Ollama's business: it describes the app, not the text.
 */
const OLLAMA_HEADERS: Record<string, string> = { Origin: '' };

/** A boundary between the two code units of one non-BMP character. */
function splitsSurrogatePair(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Limit how much surrounding text leaves the editor; this sends no file path. */
export function buildCompletionRequest(text: string, cursor: number, model: string) {
  cursor = Math.max(0, Math.min(text.length, Math.trunc(cursor) || 0));
  let start = Math.max(0, cursor - AI_CONTEXT_BEFORE);
  let end = Math.min(text.length, cursor + AI_CONTEXT_AFTER);
  // Drop partial characters rather than exceeding the context/privacy limits.
  if (splitsSurrogatePair(text, start)) start++;
  if (splitsSurrogatePair(text, end)) end--;
  const promptEnd = splitsSurrogatePair(text, cursor) ? cursor - 1 : cursor;
  const suffixStart = splitsSurrogatePair(text, cursor) ? cursor + 1 : cursor;
  return {
    model,
    prompt: text.slice(start, promptEnd),
    // The FIM template needs a non-empty suffix even at the end of a document.
    suffix: text.slice(suffixStart, end) || '\n',
    stream: false,
    options: { temperature: 0.2, num_predict: 96, stop: ['<|endoftext|>', '<|file_separator|>'] },
  };
}

/** The prototype shows only an inline, single-line suggestion. */
export function firstSuggestion(value: unknown): string {
  if (typeof value !== 'string') return '';
  const first = value.replace(/\r/g, '').split('\n', 1)[0];
  if (!first.trim() || /^(?:```|<\||<fim_|\[INST\]|<\/s>)/iu.test(first.trimStart())) return '';
  return first.slice(0, 240);
}

export async function listModels(signal?: AbortSignal): Promise<string[]> {
  if (!desktop) throw new Error('AI is available in the Windows desktop app, not this browser preview.');
  const response = await nativeFetch(`${OLLAMA_API_BASE}/api/tags`, { method: 'GET', headers: OLLAMA_HEADERS, signal, maxRedirections: 0 });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`Ollama responded with HTTP ${response.status}.`); }
  const body = await boundedJson(response, MAX_OLLAMA_RESPONSE_BYTES, 'Ollama response is too large.') as { models?: unknown };
  if (!Array.isArray(body?.models)) return [];
  return body.models.slice(0, 1_000)
    .map((item: unknown) => (item as { name?: unknown })?.name)
    .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0 && name.length <= 120);
}

export async function complete(text: string, cursor: number, model: string, signal?: AbortSignal): Promise<string> {
  if (!desktop) throw new Error('AI is available in the Windows desktop app, not this browser preview.');
  const response = await nativeFetch(AI_PROVIDERS.ollama.endpoint, {
    method: 'POST',
    headers: { ...OLLAMA_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCompletionRequest(text, cursor, model)),
    signal,
    maxRedirections: 0,
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await boundedJson(response, MAX_OLLAMA_ERROR_BYTES, 'Ollama error response is too large.') as { error?: unknown };
      if (typeof body?.error === 'string') detail = body.error.replace(/[\u0000-\u001f]/gu, ' ').slice(0, 250);
    } catch { /* Use a generic status if the error body is absent, malformed or too large. */ }
    throw new Error(detail || `Ollama responded with HTTP ${response.status}.`);
  }
  const result = await boundedJson(response, MAX_OLLAMA_RESPONSE_BYTES, 'Ollama response is too large.') as { response?: string };
  return firstSuggestion(result.response);
}

/** One reviewable action on an explicit selection. Nothing is applied here. */
export async function runAction(
  input: { selection: string; action: AiActionId; instruction?: string; model: string },
  signal?: AbortSignal,
): Promise<string> {
  if (!desktop) throw new Error('AI actions are available in the Windows desktop app, not this browser preview.');
  const body = buildActionRequest(input);
  const response = await nativeFetch(AI_PROVIDERS.ollama.endpoint, {
    method: 'POST',
    headers: { ...OLLAMA_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    maxRedirections: 0,
  });
  if (!response.ok) {
    let detail = '';
    try {
      const errorBody = await boundedJson(response, MAX_OLLAMA_ERROR_BYTES, 'Ollama error response is too large.') as { error?: unknown };
      if (typeof errorBody?.error === 'string') detail = errorBody.error.replace(/[\u0000-\u001f]/gu, ' ').slice(0, 250);
    } catch { /* Use a generic status if the error body is absent, malformed or too large. */ }
    throw new Error(detail || `Ollama responded with HTTP ${response.status}.`);
  }
  const result = await boundedJson(response, MAX_OLLAMA_RESPONSE_BYTES, 'Ollama response is too large to review safely.') as { response?: unknown };
  const kind = getAiAction(input.action)?.kind;
  return cleanActionOutput(result?.response, {
    original: input.selection,
    stripWrappingFence: kind === 'replace',
  });
}
