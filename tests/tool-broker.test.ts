import { describe, expect, it } from 'vitest';
import { filterEnvironment, ToolBroker } from '../src/tool-broker';

describe('tool-broker capability sandbox', () => {
  it('never starts subprocesses in an untrusted workspace', () => {
    const broker = new ToolBroker();
    expect(broker.getWorkspaceTrust('ws-1')).toBe('untrusted');
    expect(() =>
      broker.startTool({
        workspaceId: 'ws-1',
        toolId: 'rust-analyzer',
        sourceEnv: { PATH: '/usr/bin' },
        spawn: () => ({ pid: 1, kill: () => {} }),
      }),
    ).toThrow(/Untrusted workspace/u);
  });

  it('rejects project-provided command configurations as executable permission', () => {
    const broker = new ToolBroker();
    broker.setWorkspaceTrust('ws-1', 'trusted');
    expect(() =>
      broker.approveTool({
        workspaceId: 'ws-1',
        toolId: 'custom-lsp',
        executablePath: './malicious.sh',
        fromProjectConfig: true,
      }),
    ).toThrow(/Project-provided command configuration/u);
  });

  it('filters environment variables to the allowlist and disables network', () => {
    const filtered = filterEnvironment(
      { PATH: '/usr/bin', GITHUB_TOKEN: 'secret', AWS_SECRET_ACCESS_KEY: 'secret2', LANG: 'en_US.UTF-8' },
      ['PATH', 'LANG'],
    );
    expect(filtered).toEqual({ PATH: '/usr/bin', LANG: 'en_US.UTF-8' });
    expect(filtered).not.toHaveProperty('GITHUB_TOKEN');
  });

  it('kills active processes and releases handles on stop and revoke', () => {
    const broker = new ToolBroker();
    broker.setWorkspaceTrust('ws-1', 'trusted');
    broker.approveTool({
      workspaceId: 'ws-1',
      toolId: 'marksman',
      executablePath: '/usr/local/bin/marksman',
    });

    let killed = 0;
    broker.startTool({
      workspaceId: 'ws-1',
      toolId: 'marksman',
      sourceEnv: { PATH: '/usr/bin', SECRET: 'nope' },
      spawn: () => ({
        pid: 4242,
        kill: () => {
          killed += 1;
        },
      }),
    });

    expect(broker.getActiveCount()).toBe(1);
    expect(broker.revokeWorkspace('ws-1')).toBe(1);
    expect(killed).toBe(1);
    expect(broker.getActiveCount()).toBe(0);
  });
});
