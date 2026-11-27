import { analyzeDocumentLocally } from './builtin-assistant';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface DiagnosticItem {
  fileId: string;
  fileName: string;
  line: number;
  severity: DiagnosticSeverity;
  message: string;
  source: string;
}

export function collectWorkspaceDiagnostics(
  files: ReadonlyArray<{ id: string; name: string; content: string; isMarkdown?: boolean }>,
): DiagnosticItem[] {
  const items: DiagnosticItem[] = [];
  for (const file of files) {
    const analysis = analyzeDocumentLocally(file.content, { isMarkdown: file.isMarkdown ?? file.name.endsWith('.md') });
    for (const s of analysis.suggestions) {
      items.push({
        fileId: file.id,
        fileName: file.name,
        line: s.line,
        severity: s.kind === 'structure' ? 'warning' : 'info',
        message: `${s.title} — ${s.detail}`,
        source: 'wrytrove-local',
      });
    }
  }
  return items;
}
