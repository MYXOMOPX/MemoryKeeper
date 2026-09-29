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

  it('passes well-formed, zod-validated args through to the handler unchanged', async () => {
    const args = {
      type: 'person',
      name: 'Петя',
      key: 'Любимый чай',
      value: 'зелёный',
      relatedEntities: [{ type: 'person', name: 'Катя' }],
    };
    generateContentMock
      .mockResolvedValueOnce({ text: undefined, functionCalls: [{ name: 'write_fact', args }] })
      .mockResolvedValueOnce({ text: 'Записал', functionCalls: [] });
    handlersMocks.writeFact.mockResolvedValue({ message: 'ok' });

    const backend = createGeminiApiBackend(config);
    await backend('запиши факт');

    expect(handlersMocks.writeFact).toHaveBeenCalledWith('/vault', 'person', 'Петя', 'Любимый чай', 'зелёный', [
      { type: 'person', name: 'Катя' },
    ]);
  });

  it('rejects a call missing a required argument with a validation error, without running the handler', async () => {
    generateContentMock
      .mockResolvedValueOnce({
        text: undefined,
        functionCalls: [{ name: 'write_fact', args: { type: 'person', name: 'Петя', key: 'Любимый чай' } }],
      })
      .mockResolvedValueOnce({ text: 'Исправлюсь', functionCalls: [] });

    const backend = createGeminiApiBackend(config);
    const result = await backend('запиши факт');

    expect(result.response).toBe('Исправлюсь');
    expect(handlersMocks.writeFact).not.toHaveBeenCalled();
    const secondContents = (generateContentMock.mock.calls[1][0] as {
      contents: { parts: { functionResponse?: { name?: string; response?: { result?: { error?: string } } } }[] }[];
    }).contents;
    const functionResponse = secondContents[2].parts[0].functionResponse;
    expect(functionResponse?.name).toBe('write_fact');
    expect(functionResponse?.response?.result?.error).toMatch(/Invalid arguments for write_fact/);
    expect(functionResponse?.response?.result?.error).toMatch(/value/);
  });

  it('rejects a call with a wrongly-typed argument with a validation error', async () => {
    generateContentMock
      .mockResolvedValueOnce({ text: undefined, functionCalls: [{ name: 'search_entities', args: { query: 42 } }] })
      .mockResolvedValueOnce({ text: 'ok', functionCalls: [] });

    const backend = createGeminiApiBackend(config);
    await backend('найди');

    expect(handlersMocks.searchEntitiesHandler).not.toHaveBeenCalled();
    const secondCallArgs = generateContentMock.mock.calls[1][0] as { contents: unknown[] };
    expect(JSON.stringify(secondCallArgs.contents)).toMatch(/Invalid arguments for search_entities: query: Expected string/);
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

  it("echoes the model's real turn (candidates[0].content) verbatim, keeping thoughtSignature and text parts", async () => {
    const modelTurn = {
      role: 'model',
      parts: [
        { text: 'Сейчас посмотрю схему.' },
        { functionCall: { id: 'call-1', name: 'get_schema', args: {} }, thoughtSignature: 'test-signature' },
      ],
    };
    generateContentMock
      .mockResolvedValueOnce({
        text: 'Сейчас посмотрю схему.',
        functionCalls: [{ id: 'call-1', name: 'get_schema', args: {} }],
        candidates: [{ content: modelTurn }],
      })
      .mockResolvedValueOnce({ text: 'Готово', functionCalls: [] });
    handlersMocks.getSchema.mockResolvedValue({ types: {} });

    const backend = createGeminiApiBackend(config);
    await backend('какая схема?');

    const secondContents = (generateContentMock.mock.calls[1][0] as { contents: unknown[] }).contents;
    // The exact SDK object, not a reconstruction missing the signature/text.
    expect(secondContents[1]).toBe(modelTurn);
    expect(secondContents[1]).toEqual({
      role: 'model',
      parts: [
        { text: 'Сейчас посмотрю схему.' },
        { functionCall: { id: 'call-1', name: 'get_schema', args: {} }, thoughtSignature: 'test-signature' },
      ],
    });
  });

  it('echoes each function call id back on its functionResponse', async () => {
    generateContentMock
      .mockResolvedValueOnce({
        text: undefined,
        functionCalls: [
          { id: 'call-a', name: 'get_schema', args: {} },
          { name: 'list_entities', args: {} },
        ],
      })
      .mockResolvedValueOnce({ text: 'Готово', functionCalls: [] });
    handlersMocks.getSchema.mockResolvedValue({ types: {} });
    handlersMocks.listEntities.mockResolvedValue([]);

    const backend = createGeminiApiBackend(config);
    await backend('схема и список');

    const secondContents = (generateContentMock.mock.calls[1][0] as {
      contents: { role: string; parts: { functionResponse?: { id?: string; name?: string } }[] }[];
    }).contents;
    const responseTurn = secondContents[2];
    expect(responseTurn.role).toBe('user');
    expect(responseTurn.parts[0].functionResponse).toMatchObject({ id: 'call-a', name: 'get_schema' });
    // No id on the call -> none invented on the response.
    expect(responseTurn.parts[1].functionResponse).not.toHaveProperty('id');
    expect(responseTurn.parts[1].functionResponse?.name).toBe('list_entities');
  });

  it('falls back to rebuilding the model turn from functionCalls only when candidates[0].content is absent', async () => {
    generateContentMock
      .mockResolvedValueOnce({ text: undefined, functionCalls: [{ name: 'get_schema', args: {} }] })
      .mockResolvedValueOnce({ text: 'Готово', functionCalls: [] });
    handlersMocks.getSchema.mockResolvedValue({ types: {} });

    const backend = createGeminiApiBackend(config);
    await backend('какая схема?');

    const secondContents = (generateContentMock.mock.calls[1][0] as { contents: unknown[] }).contents;
    expect(secondContents[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'get_schema', args: {} } }] });
  });

  it('passes an abort signal derived from geminiApiTimeout to generateContent', async () => {
    generateContentMock.mockResolvedValueOnce({ text: 'ok', functionCalls: [] });

    const backend = createGeminiApiBackend(config);
    await backend('привет');

    const callArgs = generateContentMock.mock.calls[0][0] as { config: { abortSignal?: AbortSignal } };
    expect(callArgs.config.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
