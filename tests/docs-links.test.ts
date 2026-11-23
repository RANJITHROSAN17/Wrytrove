import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contributor docs rot silently: a renamed file or a stale command looks fine to the person who
 * wrote it and breaks the next newcomer's first five minutes. These checks are cheap and catch it.
 */
const repoRoot = resolve(__dirname, '..');
const entryDocs = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md'];
const docsFiles = readdirSync(join(repoRoot, 'docs'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => join('docs', name));
const docs = [...entryDocs, ...docsFiles];

const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/gu;

function localTargets(file: string): string[] {
  const source = readFileSync(join(repoRoot, file), 'utf8');
  const targets: string[] = [];
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
    const path = target.split('#')[0];
    if (path === '') continue;
    targets.push(normalize(join(file, '..', path)));
  }
  return targets;
}

describe('contributor documentation', () => {
  it('has no broken local links', () => {
    const broken = docs.flatMap((file) => localTargets(file)
      .filter((target) => !existsSync(join(repoRoot, target)))
      .map((target) => `${file} -> ${target}`));
    expect(broken).toEqual([]);
  });

  it('names the editor by its current repository, not its old one', () => {
    for (const file of entryDocs) {
      expect(readFileSync(join(repoRoot, file), 'utf8')).not.toContain('morrow-editor');
    }
  });

  it('only advertises commands that exist', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const documented = new Set<string>();
    for (const file of entryDocs) {
      for (const match of readFileSync(join(repoRoot, file), 'utf8').matchAll(/npm (?:run )?([\w:-]+)/gu)) {
        const name = match[1];
        if (name.startsWith('-') || name === 'ci' || name === 'install') continue;
        documented.add(name);
      }
    }
    expect([...documented].filter((name) => !(name in manifest.scripts))).toEqual([]);
  });
});
