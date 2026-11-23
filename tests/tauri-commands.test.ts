import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A Tauri command only becomes reachable when it is registered in three places: the `#[tauri::command]`
 * function, `build.rs`'s permission manifest, and the capability that grants it to the main webview.
 * Miss one and the app either fails to compile or silently rejects the call at runtime, so the three
 * lists are checked against each other here instead of on a Windows runner.
 */
const repoRoot = resolve(__dirname, '..');
const read = (...segments: string[]) => readFileSync(resolve(repoRoot, ...segments), 'utf8');

const commands = [...read('src-tauri', 'src', 'lib.rs').matchAll(/#\[tauri::command\][\s\S]{0,120}?\bfn (\w+)\(/gu)]
  .map((match) => match[1]);
const manifest = [...read('src-tauri', 'build.rs').matchAll(/"([a-z_]+)",/gu)].map((match) => match[1]);
const capability = JSON.parse(read('src-tauri', 'capabilities', 'default.json')) as { permissions: unknown[] };
const granted = capability.permissions.filter((entry): entry is string => typeof entry === 'string');
const kebab = (name: string) => name.replaceAll('_', '-');

describe('Tauri command wiring', () => {
  it('finds the command list', () => {
    expect(commands.length).toBeGreaterThan(5);
    expect(manifest.length).toBe(commands.length);
  });

  it('registers every command in the build manifest', () => {
    expect(commands.filter((name) => !manifest.includes(name))).toEqual([]);
    expect(manifest.filter((name) => !commands.includes(name))).toEqual([]);
  });

  it('grants every command to the main webview capability', () => {
    expect(commands.filter((name) => !granted.includes(`allow-${kebab(name)}`))).toEqual([]);
  });
});
