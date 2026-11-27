import { describe, expect, it } from 'vitest';
import { createTerminalPanelState, runTerminalCommand } from '../src/terminal-panel';

describe('terminal-panel', () => {
  it('blocks commands in untrusted workspaces', () => {
    const s0 = createTerminalPanelState();
    const s1 = runTerminalCommand(s0, 'npm test', 'untrusted');
    expect(s1.history[0]?.blocked).toBe(true);
    expect(s1.history[0]?.exitCode).toBe(1);
  });

  it('executes commands in trusted workspaces and records output', () => {
    const s0 = createTerminalPanelState();
    const s1 = runTerminalCommand(
      s0,
      'echo hello',
      'trusted',
      () => ({ output: 'hello\n', exitCode: 0 }),
    );
    expect(s1.history[0]?.blocked).toBe(false);
    expect(s1.history[0]?.output).toBe('hello\n');
    expect(s1.history[0]?.exitCode).toBe(0);
  });
});
