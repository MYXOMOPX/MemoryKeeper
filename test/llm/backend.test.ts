import { describe, it, expect } from 'vitest';
import { createLlmBackend } from '../../src/llm/backend.js';
import type { Config } from '../../src/config.js';

describe('createLlmBackend', () => {
  it('returns a callable backend when llmBackend is "agy"', () => {
    const config = {
      llmBackend: 'agy',
      agyBin: 'agy',
      agyTimeout: '2m',
      agyCwd: '/scratch',
      agyModel: 'gemini-3.8-flash-low',
    } as Config;
    expect(typeof createLlmBackend(config)).toBe('function');
  });

  it('returns a callable backend when llmBackend is "gemini-api"', () => {
    const config = {
      llmBackend: 'gemini-api',
      geminiApiKey: 'key',
      geminiApiModel: 'gemini-2.5-flash-lite',
      geminiApiTimeout: '2m',
    } as Config;
    expect(typeof createLlmBackend(config)).toBe('function');
  });
});
