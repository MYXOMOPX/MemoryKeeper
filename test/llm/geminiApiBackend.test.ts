import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../src/config.js';

const generateContentMock = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: generateContentMock } })),
}));

const handlersMocks = {
  getSchema: vi.fn(),
  listEntities: vi.fn(),
  searchEntitiesHandler: vi.fn(),
  readEntityHandler: vi.fn(),
  writeFact: vi.fn(),
  createEntity: vi.fn(),
  addAlias: vi.fn(),
  proposeSchemaChange: vi.fn(),
};
vi.mock('../../src/mcp/handlers.js', () => handlersMocks);

const { createGeminiApiBackend } = await import('../../src/llm/geminiApiBackend.js');

const config = {
  vaultPath: '/vault',
  geminiApiKey: 'test-key',
  geminiApiModel: 'gemini-2.5-flash-lite',
  geminiApiTimeout: '2m',
} as Config;

describe('createGeminiApiBackend', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    for (const fn of Object.values(handlersMocks)) fn.mockReset();
  });

  it('returns the final text when the model responds without any function calls', async () => {
    generateContentMock.mockResolvedValueOnce({ text: 'Привет!', functionCalls: [] });

    const backend = createGeminiApiBackend(config);
    const result = await backend('привет');

    expect(result.response).toBe('Привет!');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call via handlers.ts directly and continues the loop to a final response', async () => {
    generateContentMock
      .mockResolvedValueOnce({ text: undefined, functionCalls: [{ name: 'get_schema', args: {} }] })
      .mockResolvedValueOnce({ text: 'Готово', functionCalls: [] });
    handlersMocks.getSchema.mockResolvedValue({ types: {} });

    const backend = createGeminiApiBackend(config);
    const result = await backend('какая схема?');

    expect(handlersMocks.getSchema).toHaveBeenCalledWith('/vault');
    expect(result.response).toBe('Готово');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('feeds a tool error back to the model instead of throwing', async () => {
    generateContentMock
      .mockResolvedValueOnce({
        text: undefined,
        functionCalls: [{ name: 'write_fact', args: { type: 'person', name: 'Петя', key: 'X', value: 'Y' } }],
      })
      .mockResolvedValueOnce({ text: 'Понял, исправлюсь', functionCalls: [] });
    handlersMocks.writeFact.mockRejectedValue(new Error('boom'));

    const backend = createGeminiApiBackend(config);
    const result = await backend('запиши факт');

    expect(result.response).toBe('Понял, исправлюсь');
    const secondCallArgs = generateContentMock.mock.calls[1][0] as { contents: unknown[] };
    expect(JSON.stringify(secondCallArgs.contents)).toContain('boom');
  });

  it('throws once the tool-calling loop exceeds its turn limit instead of looping forever', async () => {
    generateContentMock.mockResolvedValue({ text: undefined, functionCalls: [{ name: 'get_schema', args: {} }] });
    handlersMocks.getSchema.mockResolvedValue({ types: {} });

    const backend = createGeminiApiBackend(config);
    await expect(backend('зациклись')).rejects.toThrow(/turns/);

    // Confirms this is a real repeated loop, not a check that fires after one call:
    // generateContent must have been invoked once per turn up to the limit.
    expect(generateContentMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('passes an abort signal derived from geminiApiTimeout to generateContent', async () => {
    generateContentMock.mockResolvedValueOnce({ text: 'ok', functionCalls: [] });

    const backend = createGeminiApiBackend(config);
    await backend('привет');

    const callArgs = generateContentMock.mock.calls[0][0] as { config: { abortSignal?: AbortSignal } };
    expect(callArgs.config.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
