import { describe, expect, it } from 'vitest';
import { createInitialAgentPanelState, runAgentPanelQuery } from '../src/agent-panel';
import { createSplitPaneState, toggleSplitPane } from '../src/split-editor';
import { computeLineDiffMarkers } from '../src/diff-gutter';

describe('workspace upgrades (agent-panel, split-editor, diff-gutter)', () => {
  it('runs instant local agent query and stores result', async () => {
    const initial = createInitialAgentPanelState();
    const next = await runAgentPanelQuery(initial, 'Review', '## Missing H1\nTODO: fix');
    expect(next.lastResult?.backend).toBe('instant');
    expect(next.lastResult?.suggestions?.length).toBeGreaterThan(0);
  });

  it('toggles split-pane state cleanly', () => {
    const s0 = createSplitPaneState();
    const s1 = toggleSplitPane(s0, 'file-2');
    expect(s1.enabled).toBe(true);
    expect(s1.secondaryFileId).toBe('file-2');
    const s2 = toggleSplitPane(s1, 'file-2');
    expect(s2.enabled).toBe(false);
  });

  it('computes added and modified line diff markers', () => {
    const markers = computeLineDiffMarkers('a\nb', 'a\nb2\nc');
    expect(markers).toEqual([
      { line: 2, kind: 'modified' },
      { line: 3, kind: 'added' },
    ]);
  });
});
