import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LOCAL_MODELS,
  buildAgentSystemPrompt,
  isWebGpuSupported,
} from '../src/local-llm';

describe('local-llm', () => {
  it('exposes selectable built-in models for code, general, and balanced tasks', () => {
    expect(BUILTIN_LOCAL_MODELS.length).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_LOCAL_MODELS.some((m) => m.specialty === 'code')).toBe(true);
    expect(BUILTIN_LOCAL_MODELS.some((m) => m.specialty === 'general')).toBe(true);
  });

  it('builds distinct system prompts for ask, edit, and agent modes', () => {
    expect(buildAgentSystemPrompt('ask')).toContain('Answer clearly');
    expect(buildAgentSystemPrompt('edit')).toContain('proposed replacement');
    expect(buildAgentSystemPrompt('agent')).toContain('Wrytrove Agent');
  });

  it('detects WebGPU availability safely in Node/test environments', () => {
    expect(typeof isWebGpuSupported()).toBe('boolean');
  });
});
