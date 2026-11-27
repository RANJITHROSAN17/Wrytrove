import { analyzeDocumentLocally, type BuiltinAnalysisResult } from './builtin-assistant';
import {
  BUILTIN_LOCAL_MODELS,
  isWebGpuSupported,
  runLocalLlm,
  type AgentMode,
  type LocalLlmProgress,
  type LocalModelOption,
} from './local-llm';

export type AgentBackend = 'instant' | 'webgpu';

export interface AgentSelection {
  backend: AgentBackend;
  modelId: string;
  mode: AgentMode;
}

export interface AgentRunResult {
  backend: AgentBackend;
  mode: AgentMode;
  text: string;
  suggestions?: BuiltinAnalysisResult['suggestions'];
  durationMs: number;
}

export function listAvailableAgents(): {
  instant: { id: 'instant'; label: string };
  webgpuSupported: boolean;
  localModels: readonly LocalModelOption[];
} {
  return {
    instant: { id: 'instant', label: 'Instant Local (Zero-Download)' },
    webgpuSupported: isWebGpuSupported(),
    localModels: BUILTIN_LOCAL_MODELS,
  };
}

export async function executeAgent(
  selection: AgentSelection,
  prompt: string,
  documentText: string,
  onProgress?: (status: LocalLlmProgress) => void,
): Promise<AgentRunResult> {
  const start = performance.now();

  if (selection.backend === 'instant') {
    const analysis = analyzeDocumentLocally(documentText, { isMarkdown: true });
    const summary = analysis.suggestions.length
      ? analysis.suggestions.map((s) => `• [Line ${s.line}] ${s.title}: ${s.detail}`).join('\n')
      : 'No issues found. Your document looks clean and well-structured.';
    return {
      backend: 'instant',
      mode: selection.mode,
      text: summary,
      suggestions: analysis.suggestions,
      durationMs: analysis.durationMs,
    };
  }

  const text = await runLocalLlm(
    {
      modelId: selection.modelId,
      mode: selection.mode,
      prompt,
      selection: documentText,
    },
    onProgress,
  );

  return {
    backend: 'webgpu',
    mode: selection.mode,
    text,
    durationMs: Number((performance.now() - start).toFixed(1)),
  };
}
