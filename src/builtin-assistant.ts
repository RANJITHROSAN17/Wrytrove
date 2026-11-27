export type BuiltinSuggestionKind = 'clarity' | 'structure' | 'hygiene';

export interface BuiltinSuggestion {
  id: string;
  kind: BuiltinSuggestionKind;
  line: number;
  title: string;
  detail: string;
  replacement?: {
    fromText: string;
    toText: string;
  };
}

export interface BuiltinAnalysisResult {
  suggestions: BuiltinSuggestion[];
  durationMs: number;
}

const WORDY_PHRASES: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/\bin order to\b/gi, 'in order to', 'to'],
  [/\bdue to the fact that\b/gi, 'due to the fact that', 'because'],
  [/\bat this point in time\b/gi, 'at this point in time', 'now'],
  [/\bin the event that\b/gi, 'in the event that', 'if'],
];

/**
 * Fast, zero-dependency on-device assistant that analyzes the active document
 * for writing clarity, Markdown structure, and TODO/FIXME hygiene.
 * Runs completely locally on any workstation with <5 ms typical latency.
 */
export function analyzeDocumentLocally(
  text: string,
  options: { isMarkdown?: boolean; maxSuggestions?: number } = {},
): BuiltinAnalysisResult {
  const start = performance.now();
  const maxSuggestions = options.maxSuggestions ?? 12;
  const isMarkdown = options.isMarkdown ?? true;
  const suggestions: BuiltinSuggestion[] = [];
  const lines = text.split(/\r?\n/);

  let hasTopHeading = false;
  let lastHeadingLevel = 0;

  for (let i = 0; i < lines.length && suggestions.length < maxSuggestions; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 1. Code & note hygiene (TODO / FIXME / HACK)
    const todoMatch = /\b(TODO|FIXME|HACK)\b[:\s-]*(.*)/i.exec(trimmed);
    if (todoMatch) {
      suggestions.push({
        id: `hygiene-${lineNum}`,
        kind: 'hygiene',
        line: lineNum,
        title: `${todoMatch[1].toUpperCase()} on line ${lineNum}`,
        detail: todoMatch[2]?.trim() || 'Action item marker found.',
      });
    }

    // 2. Repeated consecutive words (e.g. "the the")
    const repeatMatch = /\b([a-z]{2,})\s+\1\b/i.exec(line);
    if (repeatMatch && suggestions.length < maxSuggestions) {
      suggestions.push({
        id: `repeat-${lineNum}`,
        kind: 'clarity',
        line: lineNum,
        title: `Repeated word "${repeatMatch[1]}"`,
        detail: `Line ${lineNum} repeats "${repeatMatch[1]}".`,
        replacement: {
          fromText: repeatMatch[0],
          toText: repeatMatch[1],
        },
      });
    }

    // 3. Wordy phrases
    for (const [pattern, fromPhrase, toPhrase] of WORDY_PHRASES) {
      if (suggestions.length >= maxSuggestions) break;
      const match = pattern.exec(line);
      if (match) {
        suggestions.push({
          id: `wordy-${lineNum}-${toPhrase}`,
          kind: 'clarity',
          line: lineNum,
          title: `Simplify "${match[0]}"`,
          detail: `Consider replacing "${fromPhrase}" with "${toPhrase}".`,
          replacement: {
            fromText: match[0],
            toText: toPhrase,
          },
        });
      }
    }

    // 4. Markdown structure checks
    if (isMarkdown && suggestions.length < maxSuggestions) {
      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (headingMatch) {
        const level = headingMatch[1].length;
        if (level === 1) hasTopHeading = true;
        if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
          suggestions.push({
            id: `heading-skip-${lineNum}`,
            kind: 'structure',
            line: lineNum,
            title: `Skipped heading level (H${lastHeadingLevel} → H${level})`,
            detail: `Consider using H${lastHeadingLevel + 1} for consistent document outline.`,
          });
        }
        lastHeadingLevel = level;
      }

      if (/\[[^\]]*\]\(\s*\)/.test(line) && suggestions.length < maxSuggestions) {
        suggestions.push({
          id: `empty-link-${lineNum}`,
          kind: 'structure',
          line: lineNum,
          title: `Empty Markdown link on line ${lineNum}`,
          detail: 'Add a target URL or file path inside ().',
        });
      }
    }
  }

  if (isMarkdown && !hasTopHeading && text.trim().length > 0 && suggestions.length < maxSuggestions) {
    suggestions.unshift({
      id: 'missing-h1',
      kind: 'structure',
      line: 1,
      title: 'Missing top-level heading (# Title)',
      detail: 'Adding a # Title at the top improves outline navigation.',
    });
  }

  return {
    suggestions: suggestions.slice(0, maxSuggestions),
    durationMs: Number((performance.now() - start).toFixed(3)),
  };
}
