export interface SnippetDefinition {
  prefix: string;
  label: string;
  body: string;
  scope: 'markdown' | 'code' | 'all';
}

export const BUILTIN_SNIPPETS: readonly SnippetDefinition[] = [
  {
    prefix: 'note',
    label: 'Markdown Note Front Matter',
    scope: 'markdown',
    body: '---\ntitle: \ntags: []\n---\n\n# \n',
  },
  {
    prefix: 'todo',
    label: 'TODO Action Item',
    scope: 'all',
    body: '// TODO: ',
  },
  {
    prefix: 'fn',
    label: 'TypeScript Function',
    scope: 'code',
    body: 'export function name(): void {\n  \n}\n',
  },
];

export function findMatchingSnippets(prefix: string, scope: 'markdown' | 'code' | 'all' = 'all'): SnippetDefinition[] {
  const q = prefix.trim().toLowerCase();
  return BUILTIN_SNIPPETS.filter(
    (s) => (scope === 'all' || s.scope === 'all' || s.scope === scope) && s.prefix.startsWith(q),
  );
}
