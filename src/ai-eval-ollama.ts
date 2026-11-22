import type { EvalProvider } from './ai-evaluation';

/** Only an explicit CLI opt-in can construct this provider. Ollama itself may route remotely. */
export function makeOllamaEvalProvider(fetcher: typeof fetch = fetch): EvalProvider {
  return async (request) => fetcher('http://127.0.0.1:11434/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    redirect: 'error', signal: AbortSignal.timeout(60_000),
  });
}
