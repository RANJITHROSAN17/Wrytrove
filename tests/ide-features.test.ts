import { describe, expect, it } from 'vitest';
import { collectWorkspaceDiagnostics } from '../src/diagnostics-panel';
import { searchWorkspaceFiles } from '../src/workspace-search';
import { findMatchingSnippets } from '../src/snippets';

describe('IDE features (diagnostics, workspace-search, snippets)', () => {
  it('collects workspace diagnostics across files', () => {
    const diags = collectWorkspaceDiagnostics([
      { id: '1', name: 'notes.md', content: '## Missing H1\n// TODO: check' },
    ]);
    expect(diags.length).toBeGreaterThanOrEqual(2);
    expect(diags[0]?.fileName).toBe('notes.md');
  });

  it('searches across workspace files with line and column', () => {
    const hits = searchWorkspaceFiles(
      [
        { id: '1', name: 'a.ts', content: 'const wrytrove = 1;' },
        { id: '2', name: 'b.md', content: 'Welcome to Wrytrove!' },
      ],
      'wrytrove',
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]?.line).toBe(1);
    expect(hits[0]?.column).toBe(7);
  });

  it('matches built-in snippets by prefix and scope', () => {
    expect(findMatchingSnippets('no', 'markdown').length).toBe(1);
    expect(findMatchingSnippets('fn', 'code').length).toBe(1);
  });
});
