import { executeAgent, listAvailableAgents, type AgentBackend, type AgentRunResult } from './agent-router';
import type { AgentMode } from './local-llm';

export interface AgentPanelState {
  open: boolean;
  backend: AgentBackend;
  modelId: string;
  mode: AgentMode;
  busy: boolean;
  lastResult: AgentRunResult | null;
  lastError: string | null;
}

export function createInitialAgentPanelState(): AgentPanelState {
  const available = listAvailableAgents();
  return {
    open: false,
    backend: 'instant',
    modelId: available.localModels[0]?.id ?? 'instant',
    mode: 'ask',
    busy: false,
    lastResult: null,
    lastError: null,
  };
}

export async function runAgentPanelQuery(
  state: AgentPanelState,
  prompt: string,
  documentText: string,
): Promise<AgentPanelState> {
  const result = await executeAgent(
    {
      backend: state.backend,
      modelId: state.modelId,
      mode: state.mode,
    },
    prompt,
    documentText,
  );
  return {
    ...state,
    busy: false,
    lastResult: result,
    lastError: null,
  };
}
