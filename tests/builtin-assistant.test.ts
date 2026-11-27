import { describe, expect, it } from 'vitest';
import { analyzeDocumentLocally } from '../src/builtin-assistant';

describe('builtin-assistant', () => {
  it('detects clarity, structure, and hygiene suggestions locally', () => {
    const doc = [
      '## Subheading without H1',
      'In order to test this, we wrote the the code.',
      '#### Skipped H3',
      '// TODO: refactor this helper',
      'See [broken link]() for details.',
    ].join('\n');

    const result = analyzeDocumentLocally(doc, { isMarkdown: true });
    const ids = result.suggestions.map((s) => s.id);

    expect(ids).toContain('missing-h1');
    expect(ids).toContain('wordy-2-to');
    expect(ids).toContain('repeat-2');
    expect(ids).toContain('heading-skip-3');
    expect(ids).toContain('hygiene-4');
    expect(ids).toContain('empty-link-5');
    expect(result.durationMs).toBeLessThan(50);
  });

  it('returns empty suggestions for a clean document', () => {
    const doc = '# Clean Document\n\nEverything here is concise and well-structured.\n';
    const result = analyzeDocumentLocally(doc, { isMarkdown: true });
    expect(result.suggestions).toEqual([]);
  });
});
