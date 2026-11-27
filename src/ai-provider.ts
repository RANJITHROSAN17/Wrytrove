/** Shared privacy metadata. These descriptors describe Wrytrove's first hop, not downstream routing. */
export type AiProvider = 'ollama' | 'arena';
export type AiCapability = 'inline-completion' | 'selection-edit' | 'selection-answer' | 'arena-edit' | 'arena-ask' | 'ask-document';
export type AiRouteState = 'unknown' | 'cloud';
export interface AiProviderDescriptor {
  readonly id: AiProvider;
  readonly endpoint: string;
  readonly route: AiRouteState;
  readonly warning: string;
}
/** Single source of truth for the local Ollama origin; loopback is not proof of local processing. */
export const OLLAMA_API_BASE = 'http://127.0.0.1:11434';

export const AI_PROVIDERS: Readonly<Record<AiProvider, AiProviderDescriptor>> = {
  ollama: { id: 'ollama', endpoint: `${OLLAMA_API_BASE}/api/generate`, route: 'unknown', warning: 'Ollama may route requests to a cloud model; loopback does not prove local processing.' },
  arena: { id: 'arena', endpoint: 'https://api.arena.ai/v1/chat/completions', route: 'cloud', warning: 'Arena and its model providers may charge, retain or share data according to account terms.' },
};
const CAPABILITIES: Readonly<Record<AiProvider, readonly AiCapability[]>> = {
  ollama: ['inline-completion', 'selection-edit', 'selection-answer', 'ask-document'],
  arena: ['arena-edit', 'arena-ask', 'ask-document'],
};

export interface AiPayloadPreview {
  readonly provider: AiProvider;
  readonly capability: AiCapability;
  readonly model: string;
  readonly destination: string;
  readonly route: AiRouteState;
  readonly sourceRevision: number | null;
  /** Number of UTF-16 code units from the source actually included. */
  readonly sourceCodeUnits: number;
  readonly instructionCodeUnits: number;
  /** UTF-8 bytes in the JSON body, excluding headers such as Authorization. */
  readonly bodyBytes: number;
}

/** Pass the exact validated body that will be serialized by the provider adapter; never include headers. */
export function previewAiPayload(input: {
  provider: AiProvider; capability: AiCapability; body: { model: string }; sourceRevision: number | null;
  sourceCodeUnits: number; instructionCodeUnits: number;
}): AiPayloadPreview {
  if (!CAPABILITIES[input.provider]?.includes(input.capability)) throw new Error('Unsupported provider capability.');
  if (!/^[a-zA-Z0-9._:/-]{1,120}$/u.test(input.body.model)) throw new Error('Enter a valid model name.');
  if (input.sourceRevision !== null && (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 0)) throw new Error('Invalid source revision.');
  if (![input.sourceCodeUnits, input.instructionCodeUnits].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid source size.');
  const descriptor = AI_PROVIDERS[input.provider];
  return {
    provider: input.provider, capability: input.capability, model: input.body.model, destination: descriptor.endpoint,
    route: descriptor.route, sourceRevision: input.sourceRevision, sourceCodeUnits: input.sourceCodeUnits,
    instructionCodeUnits: input.instructionCodeUnits, bodyBytes: new TextEncoder().encode(JSON.stringify(input.body)).length,
  };
}

/** Session-only approvals; callers clear all approvals whenever the configured provider/model changes. */
export class AiSessionConsent {
  private approvals = new Set<string>();
  private key(provider: AiProvider, model: string, capability: AiCapability): string { return JSON.stringify([provider, model, capability]); }
  has(provider: AiProvider, model: string, capability: AiCapability): boolean { return this.approvals.has(this.key(provider, model, capability)); }
  grant(provider: AiProvider, model: string, capability: AiCapability): void { this.approvals.add(this.key(provider, model, capability)); }
  clear(): void { this.approvals.clear(); }
}

export interface RedactedAiAttempt {
  provider: AiProvider; capability: AiCapability; route: AiRouteState;
  bodyBytes: number; sourceCodeUnits: number; instructionCodeUnits: number;
}
/** Memory only; no model, path, revision, raw content, credential, error, or payload hash is retained. */
export class AiAttemptLedger {
  private entries: RedactedAiAttempt[] = [];
  private dropped = 0;
  constructor(private readonly limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid ledger limit.');
  }
  record(preview: AiPayloadPreview): void {
    const descriptor = AI_PROVIDERS[preview.provider];
    if (!descriptor || !CAPABILITIES[preview.provider].includes(preview.capability)
      || ![preview.bodyBytes, preview.sourceCodeUnits, preview.instructionCodeUnits].every((n) => Number.isSafeInteger(n) && n >= 0)) {
      throw new Error('Invalid request diagnostics.');
    }
    if (this.entries.length === this.limit) { this.entries.shift(); this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + 1); }
    this.entries.push({ provider: preview.provider, capability: preview.capability, route: descriptor.route,
      bodyBytes: preview.bodyBytes, sourceCodeUnits: preview.sourceCodeUnits, instructionCodeUnits: preview.instructionCodeUnits });
  }
  clear(): void { this.entries = []; this.dropped = 0; }
  diagnostics(): string {
    return JSON.stringify({ note: 'Local attempted requests only; not proof of delivery or downstream routing. Counts may be sensitive. No content, models, credentials or paths are included.', dropped: this.dropped, attempts: this.entries }, null, 2);
  }
}
export const aiAttemptLedger = new AiAttemptLedger();
