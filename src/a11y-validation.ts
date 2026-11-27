export type DocumentUiState = 'clean' | 'active' | 'dirty' | 'stale';

export interface NonColorStateCue {
  readonly state: DocumentUiState;
  readonly textMarker: string;
  readonly ariaLabelSuffix: string;
}

export function getNonColorStateCue(state: DocumentUiState): NonColorStateCue {
  switch (state) {
    case 'active':
      return { state, textMarker: '•', ariaLabelSuffix: 'active' };
    case 'dirty':
      return { state, textMarker: '*', ariaLabelSuffix: 'unsaved changes' };
    case 'stale':
      return { state, textMarker: '!', ariaLabelSuffix: 'stale on disk' };
    case 'clean':
    default:
      return { state: 'clean', textMarker: '', ariaLabelSuffix: 'saved' };
  }
}

export interface LiveAnnouncement {
  readonly politeness: 'polite' | 'assertive';
  readonly message: string;
}

export function formatLiveAnnouncement(kind: 'info' | 'error', message: string): LiveAnnouncement {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Live announcement message must be non-empty.');
  }
  return {
    politeness: kind === 'error' ? 'assertive' : 'polite',
    message: trimmed,
  };
}

export function isMinimumGeometrySupported(widthPx: number, heightPx: number, scalePercent = 100): boolean {
  if (widthPx < 720 || heightPx < 500) return false;
  if (scalePercent < 100 || scalePercent > 200) return false;
  return true;
}
