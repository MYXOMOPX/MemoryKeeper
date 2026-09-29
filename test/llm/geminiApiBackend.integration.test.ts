import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../../src/config.js';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { readEntity } from '../../src/vault/entity.js';
import { readSchema } from '../../src/vault/schema.js';
import { listProposals } from '../../src/vault/schemaProposals.js';

// Only the network is mocked. src/mcp/handlers.js is deliberately NOT mocked:
// this test runs TOOL_HANDLERS against the real handlers and a real temp vault,
// with arguments shaped the way a model following toolDeclarations.ts's JSON
// Schema would send them — so drift between that JSON Schema, the zod shapes
// and the handlers' real signatures fails here rather than in production.
const generateContentMock = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: generateContentMock } })),
}));

const { createGeminiApiBackend } = await import('../../src/llm/geminiApiBackend.js');

interface FunctionResponsePart {
  functionResponse?: { id?: string; name?: string; response?: { result?: unknown } };
}
interface Turn {
  role: string;
  parts: FunctionResponsePart[];
}

function toolTurn(calls: { name: string; args: Record<string, unknown> }[]) {
  const withIds = calls.map((call, i) => ({ id: `${call.name}-${i}`, ...call }));
  return {
    text: undefined,
    functionCalls: withIds,
    candidates: [{ content: { role: 'model', parts: withIds.map((call) => ({ functionCall: call })) } }],
  };
}

describe('createGeminiApiBackend against the real handlers (integration)', () => {
  let vaultPath: string;
  beforeEach(async () => {
    vaultPath = await makeTmpVault();
    generateContentMock.mockReset();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('runs all 8 tools end-to-end against a real vault and feeds their real results back', async () => {
    generateContentMock
      .mockResolvedValueOnce(
        toolTurn([
          {
            name: 'write_fact',
            args: {
              type: 'person',
              name: 'Петя Иванов',
              key: 'Любимый чай',
              value: 'зелёный',
              relatedEntities: [{ type: 'person', name: 'Катя' }],
            },
          },
          { name: 'add_alias', args: { type: 'person', name: 'Петя Иванов', alias: 'Петруха' } },
        ]),
      )
      .mockResolvedValueOnce(
        toolTurn([
          {
            name: 'create_entity',
            args: { type: 'event', name: 'ДР у Кати', fields: { date: '2026-10-05', location: 'Москва' } },
          },
          { name: 'get_schema', args: {} },
        ]),
      )
      .mockResolvedValueOnce(
        toolTurn([
          { name: 'list_entities', args: { type: 'person' } },
          { name: 'search_entities', args: { query: 'Петруха' } },
        ]),
      )
      .mockResolvedValueOnce(
        toolTurn([
          { name: 'read_entity', args: { type: 'person', name: 'Петя Иванов' } },
          {
            name: 'propose_schema_change',
            args: {
              description: 'Вынести любимый чай в поле',
              change: { kind: 'promote_field', entityType: 'person', factKey: 'Любимый чай' },
            },
          },
        ]),
      )
      .mockResolvedValueOnce({ text: 'Всё записал', functionCalls: [] });

    const config = {
      vaultPath,
      geminiApiKey: 'test-key',
      geminiApiModel: 'gemini-3-flash',
      geminiApiTimeout: '2m',
    } as Config;
    const backend = createGeminiApiBackend(config);
    const result = await backend('интеграционный тест');

    expect(result.response).toBe('Всё записал');
    expect(generateContentMock).toHaveBeenCalledTimes(5);

    // --- What the real handlers returned, as fed back to the model ---
    const finalContents = (generateContentMock.mock.calls[4][0] as { contents: Turn[] }).contents;
    const responses = new Map<string, { id?: string; result: unknown }>();
    for (const turn of finalContents) {
      for (const part of turn.parts ?? []) {
        if (part.functionResponse?.name) {
          responses.set(part.functionResponse.name, {
            id: part.functionResponse.id,
            result: part.functionResponse.response?.result,
          });
        }
      }
    }
    expect([...responses.keys()].sort()).toEqual(
      [
        'add_alias',
        'create_entity',
        'get_schema',
        'list_entities',
        'propose_schema_change',
        'read_entity',
        'search_entities',
        'write_fact',
      ].sort(),
    );
    // No tool call was rejected by validation or failed inside its handler.
    for (const [name, { result }] of responses) {
      expect(result, name).not.toHaveProperty('error');
    }
    expect(responses.get('write_fact')?.id).toBe('write_fact-0');

    expect((responses.get('write_fact')?.result as { message: string }).message).toContain('Петя Иванов');
    expect((responses.get('add_alias')?.result as { message: string }).message).toContain('Петруха');
    expect((responses.get('create_entity')?.result as { message: string }).message).toContain('Создано: event/ДР у Кати');

    const schemaResult = responses.get('get_schema')?.result as { types: Record<string, { folder: string }> };
    expect(schemaResult.types.person.folder).toBe('People');
    expect(schemaResult.types.event.folder).toBe('Events');

    // list_entities/search_entities/read_entity reflect what was written EARLIER in the same run.
    expect(responses.get('list_entities')?.result).toEqual([
      { type: 'person', name: 'Петя Иванов', aliases: ['Петруха'] },
    ]);
    expect(responses.get('search_entities')?.result).toEqual([{ type: 'person', name: 'Петя Иванов' }]);
    const readResult = responses.get('read_entity')?.result as {
      frontmatter: { aliases: string[] };
      factLines: string[];
    };
    expect(readResult.frontmatter.aliases).toEqual(['Петруха']);
    expect(readResult.factLines).toHaveLength(1);
    expect(readResult.factLines[0]).toContain('Любимый чай: зелёный [[Катя]]');

    const proposeResult = responses.get('propose_schema_change')?.result as { id: string; message: string };
    expect(proposeResult.id).toEqual(expect.any(String));

    // --- What actually landed on disk in the temp vault ---
    const schema = await readSchema(vaultPath);
    const petya = await readEntity(vaultPath, schema, 'person', 'Петя Иванов');
    expect(petya).not.toBeNull();
    expect(petya?.frontmatter.aliases).toEqual(['Петруха']);
    expect(petya?.factLines[0]).toContain('Любимый чай: зелёный [[Катя]]');

    const birthday = await readEntity(vaultPath, schema, 'event', 'ДР у Кати');
    expect(birthday).not.toBeNull();
    expect(birthday?.frontmatter.date).toBe('2026-10-05');
    expect(birthday?.frontmatter.location).toBe('Москва');

    const proposals = await listProposals(vaultPath);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: proposeResult.id,
      description: 'Вынести любимый чай в поле',
      change: { kind: 'promote_field', entityType: 'person', factKey: 'Любимый чай' },
    });
    // Proposing must not apply the change.
    expect(petya?.frontmatter['Любимый чай']).toBeUndefined();
  });
});
