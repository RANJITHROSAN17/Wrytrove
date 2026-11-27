export type AgentMode = 'ask' | 'edit' | 'agent';

export interface LocalModelOption {
  id: string;
  label: string;
  specialty: 'code' | 'general' | 'balanced';
  approxSizeMb: number;
}

export const BUILTIN_LOCAL_MODELS: readonly LocalModelOption[] = [
  {
    id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 Coder 1.5B (Code)',
    specialty: 'code',
    approxSizeMb: 900,
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B (Fast Writing & Q&A)',
    specialty: 'general',
    approxSizeMb: 700,
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 3B (Higher Quality)',
    specialty: 'balanced',
    approxSizeMb: 1800,
  },
];

export interface LocalLlmProgress {
  progress: number;
  text: string;
}

export interface LocalLlmRequest {
  modelId: string;
  mode: AgentMode;
  prompt: string;
  selection?: string;
}

export function isWebGpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function buildAgentSystemPrompt(mode: AgentMode): string {
  switch (mode) {
    case 'ask':
      return 'You are Wrytrove, a concise local-first assistant. Answer clearly and cite only what is in the provided text.';
    case 'edit':
      return 'You are Wrytrove, a local-first editor assistant. Return only the proposed replacement text for the user selection so it can be reviewed before applying.';
    case 'agent':
      return 'You are Wrytrove Agent. Break the task into clear steps, explain any proposed changes, and never assume unverified file contents.';
  }
}

export async function runLocalLlm(
  request: LocalLlmRequest,
  onProgress?: (status: LocalLlmProgress) => void,
): Promise<string> {
  if (!isWebGpuSupported()) {
    throw new Error('WebGPU is not available on this workstation. Use local Ollama or Arena instead.');
  }

  const webllm = await import('@mlc-ai/web-llm');
  const engine = await webllm.CreateMLCEngine(request.modelId, {
    initProgressCallback: (report) => {
      onProgress?.({ progress: report.progress, text: report.text });
    },
  });

  const userContent = request.selection
    ? `${request.prompt}\n\n---\n${request.selection}`
    : request.prompt;

  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: buildAgentSystemPrompt(request.mode) },
      { role: 'user', content: userContent },
    ],
    temperature: request.mode === 'edit' ? 0.2 : 0.4,
  });

  return reply.choices[0]?.message?.content ?? '';
}
