import type { WorkspaceTrustState } from './tool-broker';

export interface TerminalEntry {
  id: string;
  command: string;
  output: string;
  exitCode: number;
  blocked: boolean;
}

export interface TerminalPanelState {
  open: boolean;
  history: TerminalEntry[];
  maxEntries: number;
}

export function createTerminalPanelState(maxEntries = 100): TerminalPanelState {
  return {
    open: false,
    history: [],
    maxEntries,
  };
}

export function runTerminalCommand(
  state: TerminalPanelState,
  command: string,
  trustState: WorkspaceTrustState,
  executor?: (cmd: string) => { output: string; exitCode: number },
): TerminalPanelState {
  const allowed = trustState === 'trusted';
  const entry: TerminalEntry = allowed
    ? (() => {
        const res = executor ? executor(command) : { output: '', exitCode: 0 };
        return {
          id: `term-${Date.now()}-${state.history.length}`,
          command,
          output: res.output,
          exitCode: res.exitCode,
          blocked: false,
        };
      })()
    : {
        id: `term-${Date.now()}-${state.history.length}`,
        command,
        output: 'Command blocked: workspace is untrusted.',
        exitCode: 1,
        blocked: true,
      };

  return {
    ...state,
    history: [...state.history, entry].slice(-state.maxEntries),
  };
}
