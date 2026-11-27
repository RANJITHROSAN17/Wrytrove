export type LineDiffKind = 'added' | 'modified';

export interface LineDiffMarker {
  line: number;
  kind: LineDiffKind;
}

/**
 * Computes lightweight line-level diff markers between the last saved
 * disk snapshot and the current editor text.
 */
export function computeLineDiffMarkers(savedText: string, currentText: string): LineDiffMarker[] {
  if (savedText === currentText) return [];
  const savedLines = savedText.split(/\r?\n/);
  const currentLines = currentText.split(/\r?\n/);
  const markers: LineDiffMarker[] = [];

  for (let i = 0; i < currentLines.length; i++) {
    if (i >= savedLines.length) {
      markers.push({ line: i + 1, kind: 'added' });
    } else if (currentLines[i] !== savedLines[i]) {
      markers.push({ line: i + 1, kind: 'modified' });
    }
  }
  return markers;
}
