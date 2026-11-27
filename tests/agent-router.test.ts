import { describe, expect, it } from 'vitest';
import { executeAgent, listAvailableAgents } from '../src/agent-router';

describe('agent-router', () => {
  it('lists instant local and WebGPU model options', () => {
    const agents = listAvailableAgents();
    expect(agents.instant.id).toBe('instant');
    expect(agents.localModels.length).toBeGreaterThanOrEqual(3);
  });

  it('executes instant local analysis without network or WebGPU', async () => {
    const res = await executeAgent(
      { backend: 'instant', modelId: 'instant', mode: 'ask' },
      'Check my document',
      '## Missing H1\nIn order to test the the app.',
    );
    expect(res.backend).toBe('instant');
    expect(res.suggestions?.length).toBeGreaterThan(0);
    expect(res.text).toContain('Missing top-level heading');
  });
});
