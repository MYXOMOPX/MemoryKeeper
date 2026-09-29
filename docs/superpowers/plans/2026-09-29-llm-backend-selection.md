# LLM Backend Selection (agy vs Gemini API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bot call either `agy` (current, unchanged) or the Gemini API directly (new), selected once at deploy time via an env var, behind one shared `LlmBackend` interface.

**Architecture:** A small abstraction (`LlmBackend = (prompt) => Promise<{response, raw}>`) with two implementations: `agyBackend` (thin wrapper around the existing, untouched `runHeadless`) and `geminiApiBackend` (a self-implemented tool-calling loop using `@google/genai`, since the raw API has no agentic loop of its own — it calls `src/mcp/handlers.ts` functions directly, bypassing the MCP transport entirely). `bot/index.ts` calls whichever backend `createLlmBackend(config)` returns instead of calling `runHeadless` directly.

**Tech Stack:** Node.js/TypeScript (existing), `@google/genai` (new dependency), `vitest` (existing).

**Spec:** [docs/superpowers/specs/2026-09-29-llm-backend-selection-design.md](../specs/2026-09-29-llm-backend-selection-design.md)

## Global Constraints

- Backend selection is env-var-only, decided once at process start — no runtime switching (no Telegram command, no per-message override).
- `AGY_BIN`/`AGY_TIMEOUT`/`AGY_CWD`/`AGY_MODEL` stay exactly as they are — not renamed, not generalized to cover both backends.
- `GEMINI_API_KEY` is required only when `LLM_BACKEND=gemini-api`; when the default (`agy`) is in effect, it is not read or required.
- `apply_schema_change` is not exposed to the LLM in either backend — schema changes are applied only by the bot's own `/confirm_schema` command, calling `applySchemaChange` directly.
- In `geminiApiBackend`, a tool handler throwing must not crash the loop — the error text is fed back to the model as that tool's result, and the loop continues.
- The tool-calling loop's turn limit is a fixed internal constant, not a configuration option.

---

## Task 1: Config — LLM backend selection

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: existing `Config` interface, `parseTimeoutToMs` from `src/agy/runHeadless.ts` (unchanged).
- Produces: `LlmBackendKind = 'agy' | 'gemini-api'`; `Config` gains `llmBackend: LlmBackendKind`, `geminiApiKey?: string`, `geminiApiModel: string`, `geminiApiTimeout: string`.

- [ ] **Step 1: Write the failing tests**

Add to `test/config.test.ts` (the file already imports `os`, `path`, `describe`, `it`, `expect`, `loadConfig` — keep those, extend the existing `validEnv`-based tests):

```ts
  it('parses a valid environment', () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      telegramBotToken: 'token123',
      allowedTelegramId: 42,
      vaultPath: '/vault',
      agyBin: 'agy',
      agyTimeout: '2m',
      agyCwd: path.join(os.tmpdir(), 'memory-keeper-agy-scratch'),
      agyModel: 'gemini-3.8-flash-low',
      llmBackend: 'agy',
      geminiApiKey: undefined,
      geminiApiModel: 'gemini-2.5-flash-lite',
      geminiApiTimeout: '2m',
    });
  });
```

This replaces the existing "parses a valid environment" test's `toEqual` block (it already asserts `agyBin`/`agyTimeout`/`agyCwd`/`agyModel` from a prior task — add the four new fields to that same object rather than writing a second test for them).

Then add these new test cases:

```ts
describe('loadConfig — LLM backend selection', () => {
  const validEnv = {
    TELEGRAM_BOT_TOKEN: 'token123',
    ALLOWED_TELEGRAM_ID: '42',
    VAULT_PATH: '/vault',
  };

  it('defaults llmBackend to "agy" and does not require GEMINI_API_KEY', () => {
    const config = loadConfig(validEnv);
    expect(config.llmBackend).toBe('agy');
    expect(config.geminiApiKey).toBeUndefined();
  });

  it('accepts LLM_BACKEND=gemini-api when GEMINI_API_KEY is present', () => {
    const config = loadConfig({ ...validEnv, LLM_BACKEND: 'gemini-api', GEMINI_API_KEY: 'test-key' });
    expect(config.llmBackend).toBe('gemini-api');
    expect(config.geminiApiKey).toBe('test-key');
  });

  it('throws when LLM_BACKEND=gemini-api but GEMINI_API_KEY is missing', () => {
    expect(() => loadConfig({ ...validEnv, LLM_BACKEND: 'gemini-api' })).toThrow(
      'GEMINI_API_KEY is required when LLM_BACKEND=gemini-api',
    );
  });

  it('throws on an unrecognized LLM_BACKEND value', () => {
    expect(() => loadConfig({ ...validEnv, LLM_BACKEND: 'chatgpt' })).toThrow(
      'LLM_BACKEND must be "agy" or "gemini-api"',
    );
  });

  it('uses overrides for GEMINI_API_MODEL and GEMINI_API_TIMEOUT', () => {
    const config = loadConfig({
      ...validEnv,
      LLM_BACKEND: 'gemini-api',
      GEMINI_API_KEY: 'k',
      GEMINI_API_MODEL: 'gemini-3-flash',
      GEMINI_API_TIMEOUT: '90s',
    });
    expect(config.geminiApiModel).toBe('gemini-3-flash');
    expect(config.geminiApiTimeout).toBe('90s');
  });

  it('throws at startup when GEMINI_API_TIMEOUT is not a parseable duration', () => {
    expect(() =>
      loadConfig({ ...validEnv, LLM_BACKEND: 'gemini-api', GEMINI_API_KEY: 'k', GEMINI_API_TIMEOUT: 'soon' }),
    ).toThrow('Invalid timeout');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `llmBackend`/`geminiApiKey`/`geminiApiModel`/`geminiApiTimeout` don't exist on `Config` yet, and `LLM_BACKEND`/`GEMINI_API_KEY` aren't read.

- [ ] **Step 3: Implement the config changes**

In `src/config.ts`, add the type and interface fields:

```ts
export type LlmBackendKind = 'agy' | 'gemini-api';

export interface Config {
  telegramBotToken: string;
  allowedTelegramId: number;
  vaultPath: string;
  agyBin: string;
  agyTimeout: string;
  agyCwd: string;
  agyModel: string;
  llmBackend: LlmBackendKind;
  geminiApiKey?: string;
  geminiApiModel: string;
  geminiApiTimeout: string;
}
```

In `loadConfig`, after the existing `agyTimeout`/`parseTimeoutToMs(agyTimeout)` block and before the `return`, add:

```ts
  const llmBackendRaw = env.LLM_BACKEND ?? 'agy';
  if (llmBackendRaw !== 'agy' && llmBackendRaw !== 'gemini-api') {
    throw new Error(`LLM_BACKEND must be "agy" or "gemini-api", got "${llmBackendRaw}"`);
  }
  const llmBackend: LlmBackendKind = llmBackendRaw;

  const geminiApiKey = env.GEMINI_API_KEY;
  if (llmBackend === 'gemini-api' && !geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required when LLM_BACKEND=gemini-api');
  }

  const geminiApiTimeout = env.GEMINI_API_TIMEOUT ?? '2m';
  parseTimeoutToMs(geminiApiTimeout);
```

And extend the returned object:

```ts
  return {
    telegramBotToken,
    allowedTelegramId,
    vaultPath,
    agyBin: env.AGY_BIN ?? 'agy',
    agyTimeout,
    agyCwd: env.AGY_CWD ?? path.join(os.tmpdir(), 'memory-keeper-agy-scratch'),
    agyModel: env.AGY_MODEL ?? 'gemini-3.8-flash-low',
    llmBackend,
    geminiApiKey,
    geminiApiModel: env.GEMINI_API_MODEL ?? 'gemini-2.5-flash-lite',
    geminiApiTimeout,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (all cases, including the pre-existing ones)

- [ ] **Step 5: Run the full suite and commit**

Run: `npx vitest run && npm run build`
Expected: PASS, clean build.

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add LLM_BACKEND/GEMINI_API_* config for backend selection"
```

---

## Task 2: Gemini tool declarations (JSON Schema)

**Files:**
- Create: `src/llm/toolDeclarations.ts`
- Test: `test/llm/toolDeclarations.test.ts`

**Interfaces:**
- Consumes: nothing (pure data, mirrors the zod schemas already in `src/mcp/server.ts` by hand — deliberate duplication, see spec).
- Produces: `ToolDeclaration { name: string; description: string; parametersJsonSchema: Record<string, unknown> }`, `TOOL_DECLARATIONS: ToolDeclaration[]` — the 8 tools `get_schema`, `list_entities`, `search_entities`, `read_entity`, `write_fact`, `create_entity`, `add_alias`, `propose_schema_change` (same set already registered in `src/mcp/server.ts`, excluding `apply_schema_change`, which is never exposed to any LLM).

- [ ] **Step 1: Write the failing tests**

`test/llm/toolDeclarations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TOOL_DECLARATIONS } from '../../src/llm/toolDeclarations.js';

describe('TOOL_DECLARATIONS', () => {
  it('declares exactly the 8 tools exposed over MCP, excluding apply_schema_change', () => {
    const names = TOOL_DECLARATIONS.map((t) => t.name).sort();
    expect(names).toEqual(
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
  });

  it('every declaration has a non-empty name and description, and an object-typed schema', () => {
    for (const decl of TOOL_DECLARATIONS) {
      expect(decl.name.length).toBeGreaterThan(0);
      expect(decl.description.length).toBeGreaterThan(0);
      expect(decl.parametersJsonSchema.type).toBe('object');
    }
  });

  it('write_fact requires type, name, key and value', () => {
    const writeFact = TOOL_DECLARATIONS.find((t) => t.name === 'write_fact');
    expect(writeFact?.parametersJsonSchema.required).toEqual(['type', 'name', 'key', 'value']);
  });

  it('propose_schema_change describes the promote_field/new_type union via oneOf', () => {
    const propose = TOOL_DECLARATIONS.find((t) => t.name === 'propose_schema_change');
    const changeSchema = (propose?.parametersJsonSchema.properties as Record<string, { oneOf?: unknown[] }>).change;
    expect(changeSchema.oneOf).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/llm/toolDeclarations.test.ts`
Expected: FAIL — `src/llm/toolDeclarations.ts` does not exist.

- [ ] **Step 3: Implement `src/llm/toolDeclarations.ts`**

```ts
export interface ToolDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'get_schema',
    description: 'Return the vault entity-type schema',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_entities',
    description: 'List entities, optionally filtered by type',
    parametersJsonSchema: {
      type: 'object',
      properties: { type: { type: 'string' } },
    },
  },
  {
    name: 'search_entities',
    description: 'Find entities by name, alias, fact text or field value',
    parametersJsonSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'read_entity',
    description: 'Read the full content of one entity',
    parametersJsonSchema: {
      type: 'object',
      properties: { type: { type: 'string' }, name: { type: 'string' } },
      required: ['type', 'name'],
    },
  },
  {
    name: 'write_fact',
    description: 'Create or update a fact on an entity, creating the entity if it does not exist',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        name: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        relatedEntities: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, name: { type: 'string' } },
            required: ['type', 'name'],
          },
        },
      },
      required: ['type', 'name', 'key', 'value'],
    },
  },
  {
    name: 'create_entity',
    description:
      'Explicitly create a new entity of a known type; if it already exists, merges fields into it without losing its facts',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        name: { type: 'string' },
        fields: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['type', 'name'],
    },
  },
  {
    name: 'add_alias',
    description:
      'Add an alternative name (alias) to an entity, keeping all its existing facts; creates the entity if it does not exist',
    parametersJsonSchema: {
      type: 'object',
      properties: { type: { type: 'string' }, name: { type: 'string' }, alias: { type: 'string' } },
      required: ['type', 'name', 'alias'],
    },
  },
  {
    name: 'propose_schema_change',
    description: 'Record a proposed schema change; it is NOT applied until the user confirms it via /confirm_schema',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        change: {
          oneOf: [
            {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['promote_field'] },
                entityType: { type: 'string' },
                factKey: { type: 'string' },
              },
              required: ['kind', 'entityType', 'factKey'],
            },
            {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['new_type'] },
                typeName: { type: 'string' },
                folder: { type: 'string' },
                structuredFields: { type: 'array', items: { type: 'string' } },
              },
              required: ['kind', 'typeName', 'folder', 'structuredFields'],
            },
          ],
        },
      },
      required: ['description', 'change'],
    },
  },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/llm/toolDeclarations.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/llm/toolDeclarations.ts test/llm/toolDeclarations.test.ts
git commit -m "feat: JSON Schema tool declarations for the Gemini API backend"
```

---

## Task 3: `LlmBackend` type + `agyBackend` wrapper

**Files:**
- Create: `src/llm/types.ts`
- Create: `src/llm/agyBackend.ts`
- Test: `test/llm/agyBackend.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1: `agyBin`, `agyTimeout`, `agyCwd`, `agyModel`), `runHeadless` from `src/agy/runHeadless.ts` (unchanged).
- Produces: `LlmBackend = (prompt: string) => Promise<{ response: string; raw: unknown }>`, `createAgyBackend(config: Config): LlmBackend`.

- [ ] **Step 1: Create `src/llm/types.ts`**

```ts
export type LlmBackend = (prompt: string) => Promise<{ response: string; raw: unknown }>;
```

(No test needed for a type-only file — nothing to execute.)

- [ ] **Step 2: Write the failing test for `agyBackend`**

`test/llm/agyBackend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../src/config.js';

const runHeadlessMock = vi.fn();
vi.mock('../../src/agy/runHeadless.js', () => ({ runHeadless: (...args: unknown[]) => runHeadlessMock(...args) }));

const { createAgyBackend } = await import('../../src/llm/agyBackend.js');

describe('createAgyBackend', () => {
  beforeEach(() => {
    runHeadlessMock.mockReset();
  });

  it('forwards agy-specific config fields to runHeadless and returns its result', async () => {
    runHeadlessMock.mockResolvedValue({ response: 'ok', status: 'SUCCESS', raw: { status: 'SUCCESS' } });

    const config = {
      agyBin: 'agy',
      agyTimeout: '2m',
      agyCwd: '/scratch',
      agyModel: 'gemini-3.8-flash-low',
    } as Config;

    const backend = createAgyBackend(config);
    const result = await backend('привет');

    expect(runHeadlessMock).toHaveBeenCalledWith('привет', {
      agyBin: 'agy',
      timeout: '2m',
      cwd: '/scratch',
      model: 'gemini-3.8-flash-low',
    });
    expect(result).toEqual({ response: 'ok', status: 'SUCCESS', raw: { status: 'SUCCESS' } });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/llm/agyBackend.test.ts`
Expected: FAIL — `src/llm/agyBackend.ts` does not exist.

- [ ] **Step 4: Implement `src/llm/agyBackend.ts`**

```ts
import type { Config } from '../config.js';
import { runHeadless } from '../agy/runHeadless.js';
import type { LlmBackend } from './types.js';

export function createAgyBackend(config: Config): LlmBackend {
  return (prompt: string) =>
    runHeadless(prompt, {
      agyBin: config.agyBin,
      timeout: config.agyTimeout,
      cwd: config.agyCwd,
      model: config.agyModel,
    });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/llm/agyBackend.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add src/llm/types.ts src/llm/agyBackend.ts test/llm/agyBackend.test.ts
git commit -m "feat: LlmBackend type and agy backend wrapper (unchanged runHeadless)"
```

---

## Task 4: `geminiApiBackend` — self-hosted tool-calling loop

**Files:**
- Modify: `package.json` (add `@google/genai` dependency)
- Create: `src/llm/geminiApiBackend.ts`
- Test: `test/llm/geminiApiBackend.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1: `geminiApiKey`, `geminiApiModel`, `geminiApiTimeout`, `vaultPath`), `TOOL_DECLARATIONS` (Task 2), `LlmBackend` (Task 3), `parseTimeoutToMs` from `src/agy/runHeadless.ts`, and the 8 handler functions from `src/mcp/handlers.ts`: `getSchema(vaultPath)`, `listEntities(vaultPath, type?)`, `searchEntitiesHandler(vaultPath, query)`, `readEntityHandler(vaultPath, type, name)`, `writeFact(vaultPath, type, name, key, value, relatedEntities?)`, `createEntity(vaultPath, type, name, fields?)`, `addAlias(vaultPath, type, name, alias)`, `proposeSchemaChange(vaultPath, description, change)`.
- Produces: `createGeminiApiBackend(config: Config): LlmBackend`.

**Important — verify before trusting the code below:** the exact `@google/genai` call shape (field names on the response object, how an abort signal is passed, the `role` used for a function-result turn) is based on documentation and examples read online, not on this installed package's actual type definitions. This mirrors the situation the original plan hit with the MCP SDK in its Task 8, which was resolved the same way: implement against the best-available documented shape, but **actually check** `node_modules/@google/genai`'s `.d.ts` files after installing (Step 1 below) and adjust field names if they differ. The external behavior that matters and must be preserved is: `createGeminiApiBackend(config)` returns a function `(prompt) => Promise<{response, raw}>` that runs a real multi-turn tool-calling loop against the 8 handlers.

- [ ] **Step 1: Install the dependency and verify the SDK shape**

Run: `npm install @google/genai`

Then inspect the installed type definitions for the exact shape of: `GoogleGenAI` constructor options, `ai.models.generateContent(...)` parameters (in particular how `tools`/`functionDeclarations` and an abort signal are passed), and the response type's fields for text (`.text`) and function calls (`.functionCalls`). Look under `node_modules/@google/genai/dist/**/*.d.ts` — search for `interface GenerateContentResponse`, `interface GenerateContentParameters`, and `FunctionDeclaration`. If any field name below (`result.text`, `result.functionCalls`, `config.abortSignal`, the `'function'` role for a function-response turn) differs from what you find, use the real one instead — in both the implementation (Step 3) and the tests (Step 2), consistently.

- [ ] **Step 2: Write the failing tests**

`test/llm/geminiApiBackend.test.ts`:

```ts
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
  });

  it('passes an abort signal derived from geminiApiTimeout to generateContent', async () => {
    generateContentMock.mockResolvedValueOnce({ text: 'ok', functionCalls: [] });

    const backend = createGeminiApiBackend(config);
    await backend('привет');

    const callArgs = generateContentMock.mock.calls[0][0] as { config: { abortSignal?: AbortSignal } };
    expect(callArgs.config.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
```

If Step 1 found different field names than `text`/`functionCalls`/`config.abortSignal`, update these tests to match before running them — the tests and the implementation must agree with each other and with the real SDK, not with this draft.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/llm/geminiApiBackend.test.ts`
Expected: FAIL — `src/llm/geminiApiBackend.ts` does not exist.

- [ ] **Step 4: Implement `src/llm/geminiApiBackend.ts`**

```ts
import { GoogleGenAI } from '@google/genai';
import type { Config } from '../config.js';
import { parseTimeoutToMs } from '../agy/runHeadless.js';
import { TOOL_DECLARATIONS } from './toolDeclarations.js';
import * as handlers from '../mcp/handlers.js';
import type { LlmBackend } from './types.js';

/** Internal safety valve against a runaway tool-calling loop — not configurable. */
const MAX_TURNS = 8;

type ToolHandler = (vaultPath: string, args: Record<string, unknown>) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_schema: (vaultPath) => handlers.getSchema(vaultPath),
  list_entities: (vaultPath, args) => handlers.listEntities(vaultPath, args.type as string | undefined),
  search_entities: (vaultPath, args) => handlers.searchEntitiesHandler(vaultPath, args.query as string),
  read_entity: (vaultPath, args) => handlers.readEntityHandler(vaultPath, args.type as string, args.name as string),
  write_fact: (vaultPath, args) =>
    handlers.writeFact(
      vaultPath,
      args.type as string,
      args.name as string,
      args.key as string,
      args.value as string,
      args.relatedEntities as { type: string; name: string }[] | undefined,
    ),
  create_entity: (vaultPath, args) =>
    handlers.createEntity(
      vaultPath,
      args.type as string,
      args.name as string,
      args.fields as Record<string, string> | undefined,
    ),
  add_alias: (vaultPath, args) =>
    handlers.addAlias(vaultPath, args.type as string, args.name as string, args.alias as string),
  propose_schema_change: (vaultPath, args) =>
    handlers.proposeSchemaChange(
      vaultPath,
      args.description as string,
      args.change as Parameters<typeof handlers.proposeSchemaChange>[2],
    ),
};

interface FunctionCall {
  name?: string;
  args?: Record<string, unknown>;
}

export function createGeminiApiBackend(config: Config): LlmBackend {
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const timeoutMs = parseTimeoutToMs(config.geminiApiTimeout);

  return async (prompt: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const contents: Array<{ role: string; parts: unknown[] }> = [{ role: 'user', parts: [{ text: prompt }] }];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const result = await ai.models.generateContent({
          model: config.geminiApiModel,
          contents,
          config: {
            abortSignal: controller.signal,
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          },
        });

        const functionCalls = (result.functionCalls ?? []) as FunctionCall[];
        if (functionCalls.length === 0) {
          return { response: result.text ?? '', raw: result };
        }

        contents.push({
          role: 'model',
          parts: functionCalls.map((call) => ({ functionCall: { name: call.name, args: call.args } })),
        });

        const responseParts: unknown[] = [];
        for (const call of functionCalls) {
          const handler = call.name ? TOOL_HANDLERS[call.name] : undefined;
          let output: unknown;
          if (!handler) {
            output = { error: `Unknown tool: ${call.name}` };
          } else {
            try {
              output = await handler(config.vaultPath, call.args ?? {});
            } catch (err) {
              output = { error: (err as Error).message };
            }
          }
          responseParts.push({ functionResponse: { name: call.name, response: { result: output } } });
        }
        contents.push({ role: 'function', parts: responseParts });
      }

      throw new Error(`gemini-api backend exceeded ${MAX_TURNS} tool-calling turns without a final response`);
    } finally {
      clearTimeout(timer);
    }
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/llm/geminiApiBackend.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: PASS, clean build.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/llm/geminiApiBackend.ts test/llm/geminiApiBackend.test.ts
git commit -m "feat: Gemini API backend with a self-hosted tool-calling loop"
```

---

## Task 5: Wire the bot to `LlmBackend`, rename `interpretAgyResponse`, update README

**Files:**
- Create: `src/llm/backend.ts`
- Test: `test/llm/backend.test.ts`
- Modify: `src/bot/respond.ts`
- Modify: `test/bot/respond.test.ts`
- Modify: `src/bot/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createAgyBackend` (Task 3), `createGeminiApiBackend` (Task 4), `Config.llmBackend` (Task 1).
- Produces: `createLlmBackend(config: Config): LlmBackend` (the only new production export); `interpretLlmResponse` replaces `interpretAgyResponse` (same signature: `(response: string) => ResponseAction`).

- [ ] **Step 1: Write the failing test for the backend factory**

`test/llm/backend.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/llm/backend.test.ts`
Expected: FAIL — `src/llm/backend.ts` does not exist.

- [ ] **Step 3: Implement `src/llm/backend.ts`**

```ts
import type { Config } from '../config.js';
import type { LlmBackend } from './types.js';
import { createAgyBackend } from './agyBackend.js';
import { createGeminiApiBackend } from './geminiApiBackend.js';

export type { LlmBackend } from './types.js';

export function createLlmBackend(config: Config): LlmBackend {
  switch (config.llmBackend) {
    case 'agy':
      return createAgyBackend(config);
    case 'gemini-api':
      return createGeminiApiBackend(config);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/llm/backend.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Rename `interpretAgyResponse` to `interpretLlmResponse`**

In `src/bot/respond.ts`, rename the exported function (the `CLARIFY_PREFIX` import and the function body stay the same):

```ts
export function interpretLlmResponse(response: string): ResponseAction {
  if (response.startsWith(CLARIFY_PREFIX)) {
    return { kind: 'clarify', text: response.slice(CLARIFY_PREFIX.length).trim() };
  }
  return { kind: 'reply', text: response };
}
```

In `test/bot/respond.test.ts`, update the import and both call sites from `interpretAgyResponse` to `interpretLlmResponse` (the test bodies and assertions do not change).

Run: `npx vitest run test/bot/respond.test.ts`
Expected: PASS (2 tests) — this is a pure rename, no behavior change.

- [ ] **Step 6: Wire `src/bot/index.ts` to use `createLlmBackend`**

Replace the top of the file and the message handler:

```ts
import { mkdirSync } from 'node:fs';
import { Bot } from 'grammy';
import type { Config } from '../config.js';
import { createLlmBackend } from '../llm/backend.js';
import { isAuthorized } from './auth.js';
import { interpretLlmResponse } from './respond.js';
import { PendingContextStore } from './pendingContext.js';
import { buildPromptForMessage } from './dispatch.js';
import { getProposal, deleteProposal } from '../vault/schemaProposals.js';
import { applySchemaChange } from '../vault/applySchemaChange.js';

function log(chatId: number | string, message: string): void {
  console.log(`[${new Date().toISOString()}] [chat ${chatId}] ${message}`);
}

export function createBot(config: Config): Bot {
  // Only meaningful when llmBackend is "agy" (harmless no-op otherwise): agy
  // is a general coding-agent CLI, not a plain LLM call — run from a
  // directory with real files, it indexes that as "the project" before
  // doing anything else. Give it an empty, dedicated scratch directory.
  mkdirSync(config.agyCwd, { recursive: true });

  const backend = createLlmBackend(config);
  const bot = new Bot(config.telegramBotToken);
  const pending = new PendingContextStore();

  bot.catch((err) => {
    console.error(`Unhandled bot error for update ${err.ctx.update.update_id}:`, err.error);
  });

  bot.use(async (ctx, next) => {
    if (!isAuthorized(ctx.from?.id, config.allowedTelegramId)) return;
    await next();
  });

  bot.command('confirm_schema', async (ctx) => {
    const id = ctx.match.trim();
    log(ctx.chat.id, `/confirm_schema ${id} — looking up proposal`);
    const proposal = await getProposal(config.vaultPath, id);
    if (!proposal) {
      log(ctx.chat.id, `/confirm_schema ${id} — not found`);
      await ctx.reply(`Предложение ${id} не найдено.`);
      return;
    }
    log(ctx.chat.id, `/confirm_schema ${id} — applying (${proposal.change.kind})`);
    const result = await applySchemaChange(config.vaultPath, proposal);
    await deleteProposal(config.vaultPath, id);
    log(ctx.chat.id, `/confirm_schema ${id} — applied, updated files: ${result.updatedFiles.join(', ') || '—'}`);
    await ctx.reply(`Применено. Обновлённые файлы: ${result.updatedFiles.join(', ') || '—'}`);
  });

  bot.command('cancel_schema', async (ctx) => {
    const id = ctx.match.trim();
    log(ctx.chat.id, `/cancel_schema ${id}`);
    await deleteProposal(config.vaultPath, id);
    await ctx.reply(`Предложение ${id} отменено.`);
  });

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    log(chatId, `message received: "${ctx.message.text}"`);
    const { prompt, effectiveOriginalMessage } = buildPromptForMessage(chatId, ctx.message.text, pending);
    log(chatId, `calling ${config.llmBackend} backend...`);
    try {
      const result = await backend(prompt);
      log(chatId, `${config.llmBackend} responded`);
      log(chatId, `raw result: ${JSON.stringify(result.raw)}`);
      const action = interpretLlmResponse(result.response);
      if (action.kind === 'clarify') {
        // Not ctx.message.text: on a 2nd+ clarification round that is only the
        // user's answer to the previous question, not the original message.
        log(chatId, `asking for clarification: "${action.text}"`);
        pending.set({ chatId, originalMessage: effectiveOriginalMessage, question: action.text });
      } else {
        log(chatId, `replying: "${action.text.slice(0, 200)}"`);
      }
      await ctx.reply(action.text.trim() || `${config.llmBackend} вернул пустой ответ — см. логи бота в консоли.`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [chat ${chatId}] backend call failed:`, err);
      await ctx.reply(`Ошибка: ${(err as Error).message}. Попробуйте ещё раз.`);
    }
  });

  return bot;
}
```

Note what changed from the current file: `runHeadless` is no longer imported or called directly (that only happens inside `agyBackend` now); the per-call log line no longer prints agy-specific `status`/`duration_seconds` (those live inside `result.raw`, which is backend-specific and still logged in full) — it prints which backend was used instead, which is meaningful for both.

This file has no dedicated automated test (unchanged from before this plan — it is Telegram/LLM integration glue, verified manually, same as the rest of `src/bot/index.ts` always has been).

- [ ] **Step 7: Build and run the full suite**

Run: `npm run build && npx vitest run`
Expected: clean build, all tests pass (including the pre-existing `agy`-path ones — nothing about their behavior changed).

- [ ] **Step 8: Manually verify the `agy` path still works (regression check)**

Run the bot locally exactly as before (no new env vars set, so `LLM_BACKEND` defaults to `agy`):

```bash
TELEGRAM_BOT_TOKEN=<token> ALLOWED_TELEGRAM_ID=<id> VAULT_PATH=/tmp/mk-vault node dist/index.js
```

Send a test message. Expected: identical behavior to before this plan — the log line now reads `calling agy backend...` instead of `calling agy (bin=..., timeout=...)...`, everything else the same.

If a `GEMINI_API_KEY` is available, also try `LLM_BACKEND=gemini-api GEMINI_API_KEY=<key> ... node dist/index.js` and send a test message — expected: a real reply, going through the new tool-calling loop instead of `agy`.

- [ ] **Step 9: Update `README.md`**

In the "Переменные окружения" table, add four rows after `AGY_TIMEOUT`:

```markdown
| `LLM_BACKEND` | нет (по умолчанию `agy`) | `agy` \| `gemini-api` — какой движок отвечает на сообщения |
| `GEMINI_API_KEY` | только если `LLM_BACKEND=gemini-api` | Ключ Gemini API (обычный платный тариф по токенам, не через подписку) |
| `GEMINI_API_MODEL` | нет (по умолчанию `gemini-2.5-flash-lite`) | Модель для прямого API-пути |
| `GEMINI_API_TIMEOUT` | нет (по умолчанию `2m`) | Таймаут всего tool-calling цикла для `gemini-api` |
```

Add one short paragraph right after that table:

```markdown
По умолчанию бот ходит через `agy` (бесплатно, через вашу подписку). Если
задать `LLM_BACKEND=gemini-api` и `GEMINI_API_KEY`, бот вместо этого вызывает
Gemini API напрямую — обычный платный тариф по токенам, свой собственный
цикл вызова инструментов (у прямого API нет агентного цикла, как у `agy`),
без запуска отдельного MCP-сервера — инструменты вызываются в том же
процессе. "Воткнуть Claude" в режиме `agy` не требует этой переменной вообще
— просто `AGY_MODEL=claude-sonnet-4-6` (agy поддерживает Claude через
`--model`).
```

- [ ] **Step 10: Commit**

```bash
git add src/llm/backend.ts test/llm/backend.test.ts src/bot/respond.ts test/bot/respond.test.ts src/bot/index.ts README.md
git commit -m "feat: wire bot to selectable LlmBackend, rename interpretAgyResponse"
```

---

## Self-Review Notes

- **Spec coverage:** `LlmBackend` type + `createLlmBackend` factory (Task 3 + Task 5), `agyBackend` as an unmodified-`runHeadless` wrapper (Task 3), `geminiApiBackend`'s self-hosted tool-calling loop calling `handlers.ts` directly (Task 4), JSON Schema tool declarations kept deliberately separate from `server.ts`'s zod schemas (Task 2), all four new config vars with `GEMINI_API_KEY` conditionally required (Task 1), the `interpretAgyResponse` → `interpretLlmResponse` rename (Task 5), README documentation (Task 5) — every section of the spec maps to a task.
- **Fixed a task-ordering hazard while planning:** an earlier draft put the `createLlmBackend` factory before `geminiApiBackend` existed, and put the `interpretAgyResponse` rename in its own task before updating `bot/index.ts`'s import — both would have left the project non-building between tasks. Reordered so `backend.ts` (which needs both concrete backends) and the rename (whose only consumer is `bot/index.ts`) both land in the same task as the file that would otherwise be left broken.
- **Type consistency checked:** `LlmBackend`'s `{response, raw}` shape (Task 3) matches what `agyBackend` returns (a strict superset, `AgyResult`, is structurally assignable) and what `geminiApiBackend` constructs explicitly (Task 4); `TOOL_HANDLERS`' keys (Task 4) match `TOOL_DECLARATIONS`' names (Task 2) exactly, which in turn match `handlers.ts`'s actual exports (already in the codebase, listed verbatim in Task 4's Interfaces block).
- **Known, flagged uncertainty (not a placeholder — an explicit verify-then-adapt step, same pattern used successfully for the MCP SDK in the original plan's Task 8):** the exact `@google/genai` response/request field names in Task 4. Step 1 of that task is a real, actionable discovery step (inspect installed `.d.ts` files) before the code is written, not a guess left unresolved.
