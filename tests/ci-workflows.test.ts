import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CI is the only thing that runs on every Windows PR, so its pins matter. These checks keep the
 * Node version single-sourced, keep `engines` aligned with the toolchain, and fail if the browser
 * suite silently drops out of CI again.
 */
const repoRoot = resolve(__dirname, '..');
const workflowDir = join(repoRoot, '.github', 'workflows');
const workflows = readdirSync(workflowDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
const read = (...segments: string[]) => readFileSync(join(repoRoot, ...segments), 'utf8');

const nvmrcMajor = Number(read('.nvmrc').trim().split('.')[0]);
const engines = (JSON.parse(read('package.json')) as { engines?: { node?: string } }).engines;

describe('toolchain pins', () => {
  it('pins one Node version for the CI workflows', () => {
    expect(Number.isInteger(nvmrcMajor)).toBe(true);
    for (const workflow of workflows) {
      const source = read('.github', 'workflows', workflow);
      for (const match of source.matchAll(/node-version(?:-file)?:\s*'?"?([^'"\n]+)'?"?/gu)) {
        const pin = match[1].trim();
        // Either read .nvmrc, or name the exact major it contains.
        if (pin.endsWith('.nvmrc')) continue;
        expect(Number(pin.split('.')[0]), `${workflow} pins Node ${pin}`).toBe(nvmrcMajor);
      }
    }
  });

  it('documents the Node version it pins', () => {
    for (const file of ['README.md', 'docs/USER-GUIDE.md']) {
      const mentions = [...read(file).matchAll(/Node\.js (\d+)/gu)].map((match) => Number(match[1]));
      expect(mentions.length, `${file} must state the Node version`).toBeGreaterThan(0);
      for (const major of mentions) expect(major, file).toBe(nvmrcMajor);
    }
  });

  it('declares the supported Node range in package.json', () => {
    expect(engines?.node).toBeDefined();
    const minimum = Number(/\d+/u.exec(engines!.node!)?.[0]);
    expect(minimum).toBe(nvmrcMajor);
  });
});

describe('CI coverage', () => {
  const ci = read('.github', 'workflows', 'ci.yml');

  it('runs the browser suite on pull requests', () => {
    expect(ci).toMatch(/^on:/mu);
    expect(ci).toContain('pull_request');
    expect(ci).toContain('npm run test:e2e');
    expect(ci).toContain('playwright install');
  });

  it('runs every gate the project documents', () => {
    for (const command of ['npm ci', 'npm test', 'npm run build', 'npm run audit:static', 'node scripts/validate-roadmap.js']) {
      expect(ci, `ci.yml must run \`${command}\``).toContain(command);
    }
  });
});
