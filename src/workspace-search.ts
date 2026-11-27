export interface WorkspaceSearchHit {
  fileId: string;
  fileName: string;
  line: number;
  column: number;
  preview: string;
}

export function searchWorkspaceFiles(
  files: ReadonlyArray<{ id: string; name: string; content: string }>,
  query: string,
  options: { caseSensitive?: boolean; maxHits?: number } = {},
): WorkspaceSearchHit[] {
  const needle = options.caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];
  const maxHits = options.maxHits ?? 200;
  const hits: WorkspaceSearchHit[] = [];

  for (const file of files) {
    if (hits.length >= maxHits) break;
    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
      const lineText = lines[i];
      const hay = options.caseSensitive ? lineText : lineText.toLowerCase();
      const idx = hay.indexOf(needle);
      if (idx !== -1) {
        hits.push({
          fileId: file.id,
          fileName: file.name,
          line: i + 1,
          column: idx + 1,
          preview: lineText.trim().slice(0, 140),
        });
      }
    }
  }
  return hits;
}
