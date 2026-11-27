export interface SplitPaneState {
  enabled: boolean;
  secondaryFileId: string | null;
  ratio: number;
}

export function createSplitPaneState(): SplitPaneState {
  return {
    enabled: false,
    secondaryFileId: null,
    ratio: 0.5,
  };
}

export function toggleSplitPane(
  state: SplitPaneState,
  secondaryFileId: string | null,
): SplitPaneState {
  if (state.enabled && state.secondaryFileId === secondaryFileId) {
    return { ...state, enabled: false };
  }
  return {
    ...state,
    enabled: true,
    secondaryFileId,
  };
}
