# MemoryKeeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot that turns free-text messages into structured facts in an Obsidian-compatible vault, and answers questions from those facts, using Antigravity CLI (`agy`) as the LLM with MCP tool-calling.

**Architecture:** A Node/TypeScript bot receives Telegram messages and, for each one, runs an independent headless `agy` subprocess. `agy` calls MCP tools (implemented by us) to search, read and write markdown entity files in a vault. The vault lives on Google Drive, mounted on the VPS host via `rclone` (outside Docker); the bot, MCP server and `agy` binary run together inside one Docker container that receives the host mount as a plain bind-mount volume.

**Tech Stack:** Node.js 20 + TypeScript, grammY (Telegram), `@modelcontextprotocol/sdk` + zod (MCP server), gray-matter + `yaml` (vault files), Antigravity CLI (`agy`) headless mode, vitest, Docker + docker-compose, rclone + systemd (host).

**Spec:** [docs/superpowers/specs/2026-09-27-memory-keeper-design.md](../specs/2026-09-27-memory-keeper-design.md)

## Global Constraints

- Единственный пользователь бота — доступ проверяется по одному захардкоженному Telegram ID, без ролей.
- Не заводить платных подписок сверх уже оплаченной Google AI Pro/Ultra, пока не подтверждено обратное (см. Task 15).
- `rclone mount` работает только на хосте; в Docker заворачиваются только бот, MCP-сервер и `agy`.
- Изменение схемы (`_schema.yaml`) применяется только по явному подтверждению пользователя (`/confirm_schema <id>`), без срока давности предложения.
- Уточняющий диалог живёт максимум 1 час с момента последнего сообщения в нём; после — следующее сообщение независимое.
- Ни один вызов `agy` не использует `--resume`: каждый вызов независим, состояние хранится в бота/vault, а не в памяти LLM.
- Факты о событии пишутся только в файл события со ссылкой на участника, не дублируются в файл человека.

---

## Task 1: Project scaffolding + config module

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `Config` interface `{ telegramBotToken: string; allowedTelegramId: number; vaultPath: string; agyBin: string; agyTimeout: string }`; `loadConfig(env?: NodeJS.ProcessEnv): Config`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "memory-keeper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "node dist/index.js",
    "mcp-server": "node dist/mcp/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "grammy": "^1.30.0",
    "gray-matter": "^4.0.3",
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.log
.env
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 6: Write the failing test for config loading**

`test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const validEnv = {
    TELEGRAM_BOT_TOKEN: 'token123',
    ALLOWED_TELEGRAM_ID: '42',
    VAULT_PATH: '/vault',
  };

  it('parses a valid environment', () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      telegramBotToken: 'token123',
      allowedTelegramId: 42,
      vaultPath: '/vault',
      agyBin: 'agy',
      agyTimeout: '2m',
    });
  });

  it('uses overrides for agyBin and agyTimeout when present', () => {
    const config = loadConfig({ ...validEnv, AGY_BIN: '/usr/local/bin/agy', AGY_TIMEOUT: '5m' });
    expect(config.agyBin).toBe('/usr/local/bin/agy');
    expect(config.agyTimeout).toBe('5m');
  });

  it('throws when TELEGRAM_BOT_TOKEN is missing', () => {
    const { TELEGRAM_BOT_TOKEN, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow('TELEGRAM_BOT_TOKEN is required');
  });

  it('throws when ALLOWED_TELEGRAM_ID is not an integer', () => {
    expect(() => loadConfig({ ...validEnv, ALLOWED_TELEGRAM_ID: 'abc' })).toThrow(
      'ALLOWED_TELEGRAM_ID must be an integer',
    );
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `src/config.ts` does not exist yet.

- [ ] **Step 8: Implement `src/config.ts`**

```ts
export interface Config {
  telegramBotToken: string;
  allowedTelegramId: number;
  vaultPath: string;
  agyBin: string;
  agyTimeout: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
  const allowedTelegramIdRaw = env.ALLOWED_TELEGRAM_ID;
  const vaultPath = env.VAULT_PATH;

  if (!telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (!allowedTelegramIdRaw) throw new Error('ALLOWED_TELEGRAM_ID is required');
  if (!vaultPath) throw new Error('VAULT_PATH is required');

  const allowedTelegramId = Number(allowedTelegramIdRaw);
  if (!Number.isInteger(allowedTelegramId)) {
    throw new Error(`ALLOWED_TELEGRAM_ID must be an integer, got "${allowedTelegramIdRaw}"`);
  }

  return {
    telegramBotToken,
    allowedTelegramId,
    vaultPath,
    agyBin: env.AGY_BIN ?? 'agy',
    agyTimeout: env.AGY_TIMEOUT ?? '2m',
  };
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/config.ts test/config.test.ts
git commit -m "feat: project scaffolding and env config loader"
```

---

## Task 2: Vault schema module (`_schema.yaml`)

**Files:**
- Create: `src/vault/types.ts`
- Create: `src/vault/schema.ts`
- Create: `test/helpers/tmpVault.ts`
- Test: `test/vault/schema.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `EntityTypeSchema { folder: string; structuredFields: string[] }`, `VaultSchema { types: Record<string, EntityTypeSchema> }`, `defaultSchema(): VaultSchema`, `schemaFilePath(vaultPath): string`, `readSchema(vaultPath): Promise<VaultSchema>`, `writeSchema(vaultPath, schema): Promise<void>`.

- [ ] **Step 1: Create the tmp-vault test helper**

`test/helpers/tmpVault.ts`:
```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function makeTmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'memory-keeper-'));
}

export async function removeTmpVault(vaultPath: string): Promise<void> {
  await fs.rm(vaultPath, { recursive: true, force: true });
}
```

- [ ] **Step 2: Create `src/vault/types.ts` with the schema types**

```ts
export interface EntityTypeSchema {
  folder: string;
  structuredFields: string[];
}

export interface VaultSchema {
  types: Record<string, EntityTypeSchema>;
}
```

- [ ] **Step 3: Write the failing test for schema read/write**

`test/vault/schema.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { readSchema, writeSchema, defaultSchema, schemaFilePath } from '../../src/vault/schema.js';

describe('vault schema', () => {
  let vaultPath: string;

  afterEach(async () => {
    if (vaultPath) await removeTmpVault(vaultPath);
  });

  it('bootstraps a default schema with person and event when none exists', async () => {
    vaultPath = await makeTmpVault();
    const schema = await readSchema(vaultPath);
    expect(schema.types.person.folder).toBe('People');
    expect(schema.types.event.folder).toBe('Events');
    const written = await fs.readFile(schemaFilePath(vaultPath), 'utf8');
    expect(written).toContain('People');
  });

  it('round-trips a written schema', async () => {
    vaultPath = await makeTmpVault();
    const schema = defaultSchema();
    schema.types.place = { folder: 'Places', structuredFields: [] };
    await writeSchema(vaultPath, schema);
    const reloaded = await readSchema(vaultPath);
    expect(reloaded.types.place).toEqual({ folder: 'Places', structuredFields: [] });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run test/vault/schema.test.ts`
Expected: FAIL — `src/vault/schema.ts` does not exist.

- [ ] **Step 5: Implement `src/vault/schema.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { VaultSchema } from './types.js';

const SCHEMA_FILENAME = '_schema.yaml';

export function defaultSchema(): VaultSchema {
  return {
    types: {
      person: { folder: 'People', structuredFields: [] },
      event: { folder: 'Events', structuredFields: ['date', 'location'] },
    },
  };
}

export function schemaFilePath(vaultPath: string): string {
  return path.join(vaultPath, SCHEMA_FILENAME);
}

export async function readSchema(vaultPath: string): Promise<VaultSchema> {
  const filePath = schemaFilePath(vaultPath);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return YAML.parse(raw) as VaultSchema;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const schema = defaultSchema();
      await writeSchema(vaultPath, schema);
      return schema;
    }
    throw err;
  }
}

export async function writeSchema(vaultPath: string, schema: VaultSchema): Promise<void> {
  await fs.mkdir(vaultPath, { recursive: true });
  await fs.writeFile(schemaFilePath(vaultPath), YAML.stringify(schema), 'utf8');
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/vault/schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add src/vault/types.ts src/vault/schema.ts test/helpers/tmpVault.ts test/vault/schema.test.ts
git commit -m "feat: vault schema read/write with default bootstrap"
```

---

## Task 3: Entity file read/write

**Files:**
- Modify: `src/vault/types.ts` (add `EntityFrontmatter`, `EntityFile`)
- Create: `src/vault/entity.ts`
- Test: `test/vault/entity.test.ts`

**Interfaces:**
- Consumes: `VaultSchema` (Task 2).
- Produces: `EntityFrontmatter { type: string; aliases: string[]; [field: string]: unknown }`, `EntityFile { type: string; name: string; frontmatter: EntityFrontmatter; factLines: string[]; notes: string }`, `entityFilePath`, `parseEntity`, `serializeEntity`, `readEntity`, `writeEntity`, `listEntityFiles`, `listAllEntities`.

- [ ] **Step 1: Add entity types to `src/vault/types.ts`**

Append to the existing file:
```ts
export interface EntityFrontmatter {
  type: string;
  aliases: string[];
  [field: string]: unknown;
}

export interface EntityFile {
  type: string;
  name: string;
  frontmatter: EntityFrontmatter;
  factLines: string[];
  notes: string;
}
```

- [ ] **Step 2: Write the failing test for entity read/write**

`test/vault/entity.test.ts`:
```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { defaultSchema } from '../../src/vault/schema.js';
import { readEntity, writeEntity, listEntityFiles, listAllEntities } from '../../src/vault/entity.js';
import type { EntityFile } from '../../src/vault/types.js';

describe('entity read/write', () => {
  let vaultPath: string;
  const schema = defaultSchema();

  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('returns null for a missing entity', async () => {
    expect(await readEntity(vaultPath, schema, 'person', 'Петя Иванов')).toBeNull();
  });

  it('round-trips an entity through write and read', async () => {
    const entity: EntityFile = {
      type: 'person',
      name: 'Петя Иванов',
      frontmatter: { type: 'person', aliases: ['Петя'] },
      factLines: ['- Первая девушка: [[Яна Сергеева]] _(добавлено 2026-09-19)_'],
      notes: 'Любит late-night звонки.',
    };
    await writeEntity(vaultPath, schema, entity);
    const reloaded = await readEntity(vaultPath, schema, 'person', 'Петя Иванов');
    expect(reloaded?.frontmatter.aliases).toEqual(['Петя']);
    expect(reloaded?.factLines).toEqual(entity.factLines);
    expect(reloaded?.notes).toBe('Любит late-night звонки.');
  });

  it('lists entity file names for a type, empty when folder is absent', async () => {
    expect(await listEntityFiles(vaultPath, schema, 'person')).toEqual([]);
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Яна Сергеева',
      frontmatter: { type: 'person', aliases: [] },
      factLines: [],
      notes: '',
    });
    expect(await listEntityFiles(vaultPath, schema, 'person')).toEqual(['Яна Сергеева']);
  });

  it('lists all entities across all types', async () => {
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Петя Иванов',
      frontmatter: { type: 'person', aliases: [] },
      factLines: [],
      notes: '',
    });
    await writeEntity(vaultPath, schema, {
      type: 'event',
      name: 'ДР у Кати 2026-09-20',
      frontmatter: { type: 'event', aliases: [], date: '2026-09-20' },
      factLines: [],
      notes: '',
    });
    const all = await listAllEntities(vaultPath, schema);
    expect(all.map((e) => e.name).sort()).toEqual(['ДР у Кати 2026-09-20', 'Петя Иванов']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/vault/entity.test.ts`
Expected: FAIL — `src/vault/entity.ts` does not exist.

- [ ] **Step 4: Implement `src/vault/entity.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { VaultSchema, EntityFile } from './types.js';

const FACTS_HEADING = '## Факты';
const NOTES_HEADING = '## Заметки';

export function entityFilePath(vaultPath: string, schema: VaultSchema, type: string, name: string): string {
  const typeSchema = schema.types[type];
  if (!typeSchema) throw new Error(`Unknown entity type: ${type}`);
  return path.join(vaultPath, typeSchema.folder, `${name}.md`);
}

export function serializeEntity(entity: EntityFile): string {
  const body = [
    FACTS_HEADING,
    ...(entity.factLines.length > 0 ? entity.factLines : ['(пока нет фактов)']),
    '',
    NOTES_HEADING,
    entity.notes,
  ].join('\n');
  return matter.stringify(body, entity.frontmatter);
}

export function parseEntity(raw: string, type: string, name: string): EntityFile {
  const parsed = matter(raw);
  const lines = parsed.content.split('\n');
  const factsStart = lines.findIndex((l) => l.trim() === FACTS_HEADING);
  const notesStart = lines.findIndex((l) => l.trim() === NOTES_HEADING);

  const factLines =
    factsStart === -1
      ? []
      : lines
          .slice(factsStart + 1, notesStart === -1 ? undefined : notesStart)
          .filter((l) => l.trim().startsWith('-'));

  const notes = notesStart === -1 ? '' : lines.slice(notesStart + 1).join('\n').trim();

  return {
    type,
    name,
    frontmatter: { type, aliases: [], ...parsed.data } as EntityFile['frontmatter'],
    factLines,
    notes,
  };
}

export async function readEntity(
  vaultPath: string,
  schema: VaultSchema,
  type: string,
  name: string,
): Promise<EntityFile | null> {
  const filePath = entityFilePath(vaultPath, schema, type, name);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return parseEntity(raw, type, name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeEntity(vaultPath: string, schema: VaultSchema, entity: EntityFile): Promise<void> {
  const filePath = entityFilePath(vaultPath, schema, entity.type, entity.name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeEntity(entity), 'utf8');
}

export async function listEntityFiles(vaultPath: string, schema: VaultSchema, type: string): Promise<string[]> {
  const typeSchema = schema.types[type];
  if (!typeSchema) throw new Error(`Unknown entity type: ${type}`);
  const dir = path.join(vaultPath, typeSchema.folder);
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -'.md'.length));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function listAllEntities(vaultPath: string, schema: VaultSchema): Promise<EntityFile[]> {
  const results: EntityFile[] = [];
  for (const type of Object.keys(schema.types)) {
    const names = await listEntityFiles(vaultPath, schema, type);
    for (const name of names) {
      const entity = await readEntity(vaultPath, schema, type, name);
      if (entity) results.push(entity);
    }
  }
  return results;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/vault/entity.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/vault/types.ts src/vault/entity.ts test/vault/entity.test.ts
git commit -m "feat: entity file read/write with frontmatter and fact/notes sections"
```

---

## Task 4: Fact upsert logic

**Files:**
- Create: `src/vault/facts.ts`
- Test: `test/vault/facts.test.ts`

**Interfaces:**
- Consumes: `VaultSchema`, `EntityFile` (Tasks 2-3).
- Produces: `RelatedEntity { type: string; name: string }`, `upsertFact(entity, schema, key, value, related?, now?): EntityFile`.

- [ ] **Step 1: Write the failing tests**

`test/vault/facts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { upsertFact } from '../../src/vault/facts.js';
import { defaultSchema } from '../../src/vault/schema.js';
import type { EntityFile, VaultSchema } from '../../src/vault/types.js';

function person(): EntityFile {
  return { type: 'person', name: 'Петя', frontmatter: { type: 'person', aliases: [] }, factLines: [], notes: '' };
}

describe('upsertFact', () => {
  it('promotes to frontmatter when the key is a structured field', () => {
    const schema: VaultSchema = { types: { person: { folder: 'People', structuredFields: ['tea_preference'] } } };
    const updated = upsertFact(person(), schema, 'tea_preference', 'зелёный, без сахара');
    expect(updated.frontmatter.tea_preference).toBe('зелёный, без сахара');
    expect(updated.factLines).toEqual([]);
  });

  it('appends a new bullet for a non-structured key', () => {
    const schema = defaultSchema();
    const now = new Date('2026-09-19T00:00:00Z');
    const updated = upsertFact(person(), schema, 'Любимый чай', 'зелёный', [], now);
    expect(updated.factLines).toEqual(['- Любимый чай: зелёный _(добавлено 2026-09-19)_']);
  });

  it('replaces an existing bullet with the same key instead of duplicating it', () => {
    const schema = defaultSchema();
    const entity = { ...person(), factLines: ['- Любимый чай: чёрный _(добавлено 2026-01-01)_', '- Рост: 180 _(добавлено 2026-01-01)_'] };
    const now = new Date('2026-09-19T00:00:00Z');
    const updated = upsertFact(entity, schema, 'Любимый чай', 'зелёный', [], now);
    expect(updated.factLines).toEqual([
      '- Любимый чай: зелёный _(добавлено 2026-09-19)_',
      '- Рост: 180 _(добавлено 2026-01-01)_',
    ]);
  });

  it('includes wikilinks for related entities', () => {
    const schema = defaultSchema();
    const now = new Date('2026-09-19T00:00:00Z');
    const updated = upsertFact(person(), schema, 'Первая девушка', 'Яна', [{ type: 'person', name: 'Яна Сергеева' }], now);
    expect(updated.factLines).toEqual(['- Первая девушка: Яна [[Яна Сергеева]] _(добавлено 2026-09-19)_']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/vault/facts.test.ts`
Expected: FAIL — `src/vault/facts.ts` does not exist.

- [ ] **Step 3: Implement `src/vault/facts.ts`**

```ts
import type { VaultSchema, EntityFile } from './types.js';

export interface RelatedEntity {
  type: string;
  name: string;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bulletFor(key: string, value: string, related: RelatedEntity[], date: Date): string {
  const links = related.map((r) => `[[${r.name}]]`).join(' ');
  const suffix = links ? ` ${links}` : '';
  return `- ${key}: ${value}${suffix} _(добавлено ${formatDate(date)})_`;
}

function bulletKey(line: string): string | null {
  const match = /^-\s*([^:]+):/.exec(line.trim());
  return match ? match[1].trim() : null;
}

export function upsertFact(
  entity: EntityFile,
  schema: VaultSchema,
  key: string,
  value: string,
  related: RelatedEntity[] = [],
  now: Date = new Date(),
): EntityFile {
  const typeSchema = schema.types[entity.type];
  if (!typeSchema) throw new Error(`Unknown entity type: ${entity.type}`);

  if (typeSchema.structuredFields.includes(key)) {
    return { ...entity, frontmatter: { ...entity.frontmatter, [key]: value } };
  }

  const newLine = bulletFor(key, value, related, now);
  const existingIndex = entity.factLines.findIndex((line) => bulletKey(line) === key);
  const factLines =
    existingIndex === -1
      ? [...entity.factLines, newLine]
      : entity.factLines.map((line, i) => (i === existingIndex ? newLine : line));

  return { ...entity, factLines };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/vault/facts.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/vault/facts.ts test/vault/facts.test.ts
git commit -m "feat: fact upsert respecting schema-driven YAML promotion"
```

---

## Task 5: Search and alias resolution

**Files:**
- Create: `src/vault/search.ts`
- Test: `test/vault/search.test.ts`

**Interfaces:**
- Consumes: `EntityFile` (Task 3).
- Produces: `findByNameOrAlias(entities, query): EntityFile[]`, `searchEntities(entities, query): EntityFile[]`.

- [ ] **Step 1: Write the failing tests**

`test/vault/search.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { findByNameOrAlias, searchEntities } from '../../src/vault/search.js';
import type { EntityFile } from '../../src/vault/types.js';

const petya: EntityFile = {
  type: 'person',
  name: 'Петя Иванов',
  frontmatter: { type: 'person', aliases: ['Петя'], tea_preference: 'зелёный, без сахара' },
  factLines: ['- Первая девушка: [[Яна Сергеева]] _(добавлено 2026-09-19)_'],
  notes: '',
};
const yana: EntityFile = {
  type: 'person',
  name: 'Яна Сергеева',
  frontmatter: { type: 'person', aliases: ['Яна'] },
  factLines: [],
  notes: '',
};
const entities = [petya, yana];

describe('findByNameOrAlias', () => {
  it('matches by exact alias, case-insensitively', () => {
    expect(findByNameOrAlias(entities, 'петя')).toEqual([petya]);
  });

  it('returns empty when nothing matches', () => {
    expect(findByNameOrAlias(entities, 'Вася')).toEqual([]);
  });
});

describe('searchEntities', () => {
  it('matches a substring of an alias', () => {
    expect(searchEntities(entities, 'Ив')).toEqual([petya]);
  });

  it('matches a substring inside fact lines', () => {
    expect(searchEntities(entities, 'Яна Сергеева')).toEqual([petya, yana]);
  });

  it('matches a substring inside a structured frontmatter field', () => {
    expect(searchEntities(entities, 'зелёный')).toEqual([petya]);
  });

  it('returns empty for an empty query', () => {
    expect(searchEntities(entities, '  ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/vault/search.test.ts`
Expected: FAIL — `src/vault/search.ts` does not exist.

- [ ] **Step 3: Implement `src/vault/search.ts`**

```ts
import type { EntityFile } from './types.js';

function aliasesOf(entity: EntityFile): string[] {
  return [entity.name, ...(entity.frontmatter.aliases ?? [])];
}

export function findByNameOrAlias(entities: EntityFile[], query: string): EntityFile[] {
  const normalized = query.trim().toLowerCase();
  return entities.filter((entity) => aliasesOf(entity).some((alias) => alias.toLowerCase() === normalized));
}

export function searchEntities(entities: EntityFile[], query: string): EntityFile[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return entities.filter((entity) => {
    if (aliasesOf(entity).some((alias) => alias.toLowerCase().includes(normalized))) return true;
    if (entity.factLines.some((line) => line.toLowerCase().includes(normalized))) return true;
    if (
      Object.entries(entity.frontmatter).some(
        ([field, val]) => field !== 'aliases' && String(val).toLowerCase().includes(normalized),
      )
    )
      return true;
    return false;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/vault/search.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/vault/search.ts test/vault/search.test.ts
git commit -m "feat: alias and substring search over vault entities"
```

---

## Task 6: Schema-change proposal store

**Files:**
- Create: `src/vault/schemaProposals.ts`
- Test: `test/vault/schemaProposals.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (standalone JSON store).
- Produces: `SchemaChange` (discriminated union `promote_field` | `new_type`), `SchemaProposal { id, createdAt, description, change }`, `saveProposal(vaultPath, description, change): Promise<SchemaProposal>`, `getProposal(vaultPath, id): Promise<SchemaProposal | null>`, `deleteProposal(vaultPath, id): Promise<void>`, `listProposals(vaultPath): Promise<SchemaProposal[]>`.

- [ ] **Step 1: Write the failing tests**

`test/vault/schemaProposals.test.ts`:
```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { saveProposal, getProposal, deleteProposal, listProposals } from '../../src/vault/schemaProposals.js';

describe('schema proposals', () => {
  let vaultPath: string;
  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('saves and retrieves a proposal by id', async () => {
    const saved = await saveProposal(vaultPath, 'Вынести чай в YAML', {
      kind: 'promote_field',
      entityType: 'person',
      factKey: 'Любимый чай',
    });
    const loaded = await getProposal(vaultPath, saved.id);
    expect(loaded).toEqual(saved);
  });

  it('returns null for an unknown id', async () => {
    expect(await getProposal(vaultPath, 'missing')).toBeNull();
  });

  it('lists all saved proposals', async () => {
    await saveProposal(vaultPath, 'A', { kind: 'new_type', typeName: 'place', folder: 'Places', structuredFields: [] });
    await saveProposal(vaultPath, 'B', { kind: 'promote_field', entityType: 'person', factKey: 'X' });
    const all = await listProposals(vaultPath);
    expect(all.map((p) => p.description).sort()).toEqual(['A', 'B']);
  });

  it('deletes a proposal', async () => {
    const saved = await saveProposal(vaultPath, 'A', { kind: 'promote_field', entityType: 'person', factKey: 'X' });
    await deleteProposal(vaultPath, saved.id);
    expect(await getProposal(vaultPath, saved.id)).toBeNull();
  });

  it('lists empty when no proposals directory exists yet', async () => {
    expect(await listProposals(vaultPath)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/vault/schemaProposals.test.ts`
Expected: FAIL — `src/vault/schemaProposals.ts` does not exist.

- [ ] **Step 3: Implement `src/vault/schemaProposals.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type SchemaChange =
  | { kind: 'promote_field'; entityType: string; factKey: string }
  | { kind: 'new_type'; typeName: string; folder: string; structuredFields: string[] };

export interface SchemaProposal {
  id: string;
  createdAt: string;
  description: string;
  change: SchemaChange;
}

function proposalsDir(vaultPath: string): string {
  return path.join(vaultPath, '.schema-proposals');
}

function proposalPath(vaultPath: string, id: string): string {
  return path.join(proposalsDir(vaultPath), `${id}.json`);
}

export async function saveProposal(
  vaultPath: string,
  description: string,
  change: SchemaChange,
): Promise<SchemaProposal> {
  const proposal: SchemaProposal = { id: randomUUID(), createdAt: new Date().toISOString(), description, change };
  await fs.mkdir(proposalsDir(vaultPath), { recursive: true });
  await fs.writeFile(proposalPath(vaultPath, proposal.id), JSON.stringify(proposal, null, 2), 'utf8');
  return proposal;
}

export async function getProposal(vaultPath: string, id: string): Promise<SchemaProposal | null> {
  try {
    const raw = await fs.readFile(proposalPath(vaultPath, id), 'utf8');
    return JSON.parse(raw) as SchemaProposal;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteProposal(vaultPath: string, id: string): Promise<void> {
  await fs.rm(proposalPath(vaultPath, id), { force: true });
}

export async function listProposals(vaultPath: string): Promise<SchemaProposal[]> {
  try {
    const dir = proposalsDir(vaultPath);
    const files = await fs.readdir(dir);
    const raws = await Promise.all(
      files.filter((f) => f.endsWith('.json')).map((f) => fs.readFile(path.join(dir, f), 'utf8')),
    );
    return raws.map((raw) => JSON.parse(raw) as SchemaProposal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/vault/schemaProposals.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/vault/schemaProposals.ts test/vault/schemaProposals.test.ts
git commit -m "feat: schema-change proposal store (plain JSON, no LLM memory)"
```

---

## Task 7: Apply a confirmed schema change

**Files:**
- Create: `src/vault/applySchemaChange.ts`
- Test: `test/vault/applySchemaChange.test.ts`

**Interfaces:**
- Consumes: `readSchema`/`writeSchema` (Task 2), `listEntityFiles`/`readEntity`/`writeEntity` (Task 3), `SchemaProposal` (Task 6).
- Produces: `applySchemaChange(vaultPath, proposal): Promise<{ updatedFiles: string[] }>`.

- [ ] **Step 1: Write the failing tests**

`test/vault/applySchemaChange.test.ts`:
```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { readSchema } from '../../src/vault/schema.js';
import { writeEntity, readEntity } from '../../src/vault/entity.js';
import { applySchemaChange } from '../../src/vault/applySchemaChange.js';
import type { SchemaProposal } from '../../src/vault/schemaProposals.js';

describe('applySchemaChange', () => {
  let vaultPath: string;
  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('adds a new entity type to the schema', async () => {
    const schema = await readSchema(vaultPath);
    const proposal: SchemaProposal = {
      id: '1',
      createdAt: new Date().toISOString(),
      description: 'Add places',
      change: { kind: 'new_type', typeName: 'place', folder: 'Places', structuredFields: [] },
    };
    const result = await applySchemaChange(vaultPath, proposal);
    expect(result.updatedFiles).toEqual([]);
    const reloaded = await readSchema(vaultPath);
    expect(reloaded.types.place).toEqual({ folder: 'Places', structuredFields: [] });
    void schema;
  });

  it('promotes a fact key to frontmatter across every matching entity file', async () => {
    const schema = await readSchema(vaultPath);
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Петя',
      frontmatter: { type: 'person', aliases: [] },
      factLines: ['- Любимый чай: зелёный _(добавлено 2026-09-19)_'],
      notes: '',
    });
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Яна',
      frontmatter: { type: 'person', aliases: [] },
      factLines: ['- Рост: 165 _(добавлено 2026-09-19)_'],
      notes: '',
    });

    const proposal: SchemaProposal = {
      id: '2',
      createdAt: new Date().toISOString(),
      description: 'Promote tea preference',
      change: { kind: 'promote_field', entityType: 'person', factKey: 'Любимый чай' },
    };
    const result = await applySchemaChange(vaultPath, proposal);
    expect(result.updatedFiles).toEqual(['Петя']);

    const petya = await readEntity(vaultPath, await readSchema(vaultPath), 'person', 'Петя');
    expect(petya?.frontmatter['Любимый чай']).toBe('зелёный');
    expect(petya?.factLines).toEqual([]);

    const yana = await readEntity(vaultPath, await readSchema(vaultPath), 'person', 'Яна');
    expect(yana?.factLines).toEqual(['- Рост: 165 _(добавлено 2026-09-19)_']);

    const reloadedSchema = await readSchema(vaultPath);
    expect(reloadedSchema.types.person.structuredFields).toContain('Любимый чай');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/vault/applySchemaChange.test.ts`
Expected: FAIL — `src/vault/applySchemaChange.ts` does not exist.

- [ ] **Step 3: Implement `src/vault/applySchemaChange.ts`**

```ts
import { readSchema, writeSchema } from './schema.js';
import { listEntityFiles, readEntity, writeEntity } from './entity.js';
import type { SchemaProposal } from './schemaProposals.js';

function bulletKey(line: string): string | null {
  const match = /^-\s*([^:]+):/.exec(line.trim());
  return match ? match[1].trim() : null;
}

function bulletValue(line: string): string {
  return line
    .trim()
    .replace(/^-\s*[^:]+:\s*/, '')
    .replace(/\s*_\(добавлено [^)]+\)_\s*$/, '')
    .replace(/\s*\[\[[^\]]+\]\]/g, '')
    .trim();
}

export async function applySchemaChange(
  vaultPath: string,
  proposal: SchemaProposal,
): Promise<{ updatedFiles: string[] }> {
  const schema = await readSchema(vaultPath);

  if (proposal.change.kind === 'new_type') {
    const { typeName, folder, structuredFields } = proposal.change;
    schema.types[typeName] = { folder, structuredFields };
    await writeSchema(vaultPath, schema);
    return { updatedFiles: [] };
  }

  const { entityType, factKey } = proposal.change;
  const typeSchema = schema.types[entityType];
  if (!typeSchema) throw new Error(`Unknown entity type: ${entityType}`);

  if (!typeSchema.structuredFields.includes(factKey)) {
    typeSchema.structuredFields = [...typeSchema.structuredFields, factKey];
    await writeSchema(vaultPath, schema);
  }

  const updatedFiles: string[] = [];
  const names = await listEntityFiles(vaultPath, schema, entityType);
  for (const name of names) {
    const entity = await readEntity(vaultPath, schema, entityType, name);
    if (!entity) continue;
    const index = entity.factLines.findIndex((line) => bulletKey(line) === factKey);
    if (index === -1) continue;
    const value = bulletValue(entity.factLines[index]);
    const factLines = entity.factLines.filter((_, i) => i !== index);
    const frontmatter = { ...entity.frontmatter, [factKey]: value };
    await writeEntity(vaultPath, schema, { ...entity, frontmatter, factLines });
    updatedFiles.push(name);
  }

  return { updatedFiles };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/vault/applySchemaChange.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/vault/applySchemaChange.ts test/vault/applySchemaChange.test.ts
git commit -m "feat: deterministic apply of a confirmed schema-change proposal"
```

---

## Task 8: MCP tool handlers and stdio server

**Files:**
- Create: `src/mcp/handlers.ts`
- Create: `src/mcp/server.ts`
- Test: `test/mcp/handlers.test.ts`

**Interfaces:**
- Consumes: everything from `src/vault/*` (Tasks 2-7).
- Produces: handler functions `getSchema`, `listEntities`, `searchEntitiesHandler`, `readEntityHandler`, `writeFact`, `createEntity`, `proposeSchemaChange`, `applySchemaChangeHandler` — all `(vaultPath, ...args) => Promise<...>`. `server.ts` is the `agy`-facing stdio entrypoint (glue only, not unit-tested — verified manually in Step 6).

- [ ] **Step 1: Write the failing tests for the handlers**

`test/mcp/handlers.test.ts`:
```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import * as handlers from '../../src/mcp/handlers.js';

describe('mcp handlers', () => {
  let vaultPath: string;
  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('getSchema returns the bootstrapped default schema', async () => {
    const schema = await handlers.getSchema(vaultPath);
    expect(schema.types.person.folder).toBe('People');
  });

  it('writeFact creates a new entity when it does not exist', async () => {
    const result = await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'зелёный');
    expect(result.message).toContain('Петя');
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.factLines[0]).toContain('зелёный');
  });

  it('writeFact updates an existing entity instead of duplicating the fact', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'чёрный');
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'зелёный');
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.factLines).toHaveLength(1);
    expect(entity?.factLines[0]).toContain('зелёный');
  });

  it('createEntity sets initial frontmatter fields', async () => {
    await handlers.createEntity(vaultPath, 'event', 'ДР у Кати', { date: '2026-09-20' });
    const entity = await handlers.readEntityHandler(vaultPath, 'event', 'ДР у Кати');
    expect(entity?.frontmatter.date).toBe('2026-09-20');
  });

  it('searchEntitiesHandler finds entities written via writeFact', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя Иванов', 'Любимый чай', 'зелёный');
    const results = await handlers.searchEntitiesHandler(vaultPath, 'Иванов');
    expect(results).toEqual([{ type: 'person', name: 'Петя Иванов' }]);
  });

  it('listEntities filters by type', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'X', 'Y');
    await handlers.createEntity(vaultPath, 'event', 'ДР у Кати', {});
    const persons = await handlers.listEntities(vaultPath, 'person');
    expect(persons.map((e) => e.name)).toEqual(['Петя']);
  });

  it('proposeSchemaChange then applySchemaChangeHandler promotes the field', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'зелёный');
    const { id } = await handlers.proposeSchemaChange(vaultPath, 'Вынести чай', {
      kind: 'promote_field',
      entityType: 'person',
      factKey: 'Любимый чай',
    });
    const applied = await handlers.applySchemaChangeHandler(vaultPath, id);
    expect(applied.message).toContain('Петя');
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.frontmatter['Любимый чай']).toBe('зелёный');
  });

  it('applySchemaChangeHandler reports a missing proposal instead of throwing', async () => {
    const result = await handlers.applySchemaChangeHandler(vaultPath, 'does-not-exist');
    expect(result.message).toContain('не найдено');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp/handlers.test.ts`
Expected: FAIL — `src/mcp/handlers.ts` does not exist.

- [ ] **Step 3: Implement `src/mcp/handlers.ts`**

```ts
import { readSchema } from '../vault/schema.js';
import { listAllEntities, readEntity, writeEntity } from '../vault/entity.js';
import { searchEntities } from '../vault/search.js';
import { upsertFact, type RelatedEntity } from '../vault/facts.js';
import { saveProposal, getProposal, deleteProposal, type SchemaChange } from '../vault/schemaProposals.js';
import { applySchemaChange } from '../vault/applySchemaChange.js';
import type { EntityFile, VaultSchema } from '../vault/types.js';

function emptyEntity(type: string, name: string): EntityFile {
  return { type, name, frontmatter: { type, aliases: [] }, factLines: [], notes: '' };
}

export async function getSchema(vaultPath: string): Promise<VaultSchema> {
  return readSchema(vaultPath);
}

export async function listEntities(vaultPath: string, type?: string) {
  const schema = await readSchema(vaultPath);
  const entities = await listAllEntities(vaultPath, schema);
  return (type ? entities.filter((e) => e.type === type) : entities).map((e) => ({
    type: e.type,
    name: e.name,
    aliases: e.frontmatter.aliases,
  }));
}

export async function searchEntitiesHandler(vaultPath: string, query: string) {
  const schema = await readSchema(vaultPath);
  const entities = await listAllEntities(vaultPath, schema);
  return searchEntities(entities, query).map((e) => ({ type: e.type, name: e.name }));
}

export async function readEntityHandler(vaultPath: string, type: string, name: string) {
  const schema = await readSchema(vaultPath);
  return readEntity(vaultPath, schema, type, name);
}

export async function writeFact(
  vaultPath: string,
  type: string,
  name: string,
  key: string,
  value: string,
  relatedEntities: RelatedEntity[] = [],
): Promise<{ message: string }> {
  const schema = await readSchema(vaultPath);
  const existing = (await readEntity(vaultPath, schema, type, name)) ?? emptyEntity(type, name);
  const updated = upsertFact(existing, schema, key, value, relatedEntities);
  await writeEntity(vaultPath, schema, updated);
  return { message: `Записано: ${type}/${name} — ${key}: ${value}` };
}

export async function createEntity(
  vaultPath: string,
  type: string,
  name: string,
  fields: Record<string, string> = {},
): Promise<{ message: string }> {
  const schema = await readSchema(vaultPath);
  const entity = emptyEntity(type, name);
  entity.frontmatter = { ...entity.frontmatter, ...fields };
  await writeEntity(vaultPath, schema, entity);
  return { message: `Создано: ${type}/${name}` };
}

export async function proposeSchemaChange(
  vaultPath: string,
  description: string,
  change: SchemaChange,
): Promise<{ message: string; id: string }> {
  const proposal = await saveProposal(vaultPath, description, change);
  return {
    id: proposal.id,
    message: `Предложение сохранено (id: ${proposal.id}). Дождитесь подтверждения /confirm_schema ${proposal.id}.`,
  };
}

export async function applySchemaChangeHandler(vaultPath: string, id: string): Promise<{ message: string }> {
  const proposal = await getProposal(vaultPath, id);
  if (!proposal) return { message: `Предложение ${id} не найдено` };
  const result = await applySchemaChange(vaultPath, proposal);
  await deleteProposal(vaultPath, id);
  return { message: `Применено. Обновлённые файлы: ${result.updatedFiles.join(', ') || '—'}` };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mcp/handlers.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Implement the stdio server entrypoint `src/mcp/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as handlers from './handlers.js';

const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) throw new Error('VAULT_PATH is required for the MCP server');

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }] };
}

const server = new McpServer({ name: 'memory-keeper-vault', version: '0.1.0' });

server.tool('get_schema', 'Return the vault entity-type schema', {}, async () => textResult(await handlers.getSchema(VAULT_PATH)));

server.tool('list_entities', 'List entities, optionally filtered by type', { type: z.string().optional() }, async ({ type }) =>
  textResult(await handlers.listEntities(VAULT_PATH, type)),
);

server.tool('search_entities', 'Find entities by name, alias, fact text or field value', { query: z.string() }, async ({ query }) =>
  textResult(await handlers.searchEntitiesHandler(VAULT_PATH, query)),
);

server.tool('read_entity', 'Read the full content of one entity', { type: z.string(), name: z.string() }, async ({ type, name }) =>
  textResult(await handlers.readEntityHandler(VAULT_PATH, type, name)),
);

server.tool(
  'write_fact',
  'Create or update a fact on an entity, creating the entity if it does not exist',
  {
    type: z.string(),
    name: z.string(),
    key: z.string(),
    value: z.string(),
    relatedEntities: z.array(z.object({ type: z.string(), name: z.string() })).optional(),
  },
  async ({ type, name, key, value, relatedEntities }) =>
    textResult(await handlers.writeFact(VAULT_PATH, type, name, key, value, relatedEntities)),
);

server.tool(
  'create_entity',
  'Explicitly create a new entity of a known type',
  { type: z.string(), name: z.string(), fields: z.record(z.string()).optional() },
  async ({ type, name, fields }) => textResult(await handlers.createEntity(VAULT_PATH, type, name, fields)),
);

server.tool(
  'propose_schema_change',
  'Record a proposed schema change; it is NOT applied until the user confirms it via /confirm_schema',
  {
    description: z.string(),
    change: z.union([
      z.object({ kind: z.literal('promote_field'), entityType: z.string(), factKey: z.string() }),
      z.object({
        kind: z.literal('new_type'),
        typeName: z.string(),
        folder: z.string(),
        structuredFields: z.array(z.string()),
      }),
    ]),
  },
  async ({ description, change }) => textResult(await handlers.proposeSchemaChange(VAULT_PATH, description, change)),
);

server.tool('apply_schema_change', 'Apply a previously confirmed schema-change proposal by id', { id: z.string() }, async ({ id }) =>
  textResult(await handlers.applySchemaChangeHandler(VAULT_PATH, id)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 6: Manually smoke-test the stdio server**

Run (with a scratch vault directory):
```bash
npm run build
VAULT_PATH=/tmp/mk-smoke-vault npx @modelcontextprotocol/inspector node dist/mcp/server.js
```
Expected: the inspector connects and lists all 8 tools (`get_schema`, `list_entities`, `search_entities`, `read_entity`, `write_fact`, `create_entity`, `propose_schema_change`, `apply_schema_change`); calling `write_fact` then `read_entity` through the inspector's UI shows the fact was written to `/tmp/mk-smoke-vault`.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/handlers.ts src/mcp/server.ts test/mcp/handlers.test.ts
git commit -m "feat: MCP tool handlers and stdio server for agy"
```

---

## Task 9: `agy` headless runner

**Files:**
- Create: `src/agy/runHeadless.ts`
- Test: `test/agy/runHeadless.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (wraps `node:child_process`).
- Produces: `AgyResult { response: string; status: string; raw: unknown }`, `RunHeadlessOptions { agyBin: string; timeout: string; cwd?: string }`, `runHeadless(prompt, options): Promise<AgyResult>`.

- [ ] **Step 1: Write the failing tests with a mocked child process**

`test/agy/runHeadless.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

const { runHeadless } = await import('../../src/agy/runHeadless.js');

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

describe('runHeadless', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('resolves with the parsed response on success', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    child.stdout.emit('data', Buffer.from(JSON.stringify({ response: 'Записал факт', status: 'SUCCESS' })));
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ response: 'Записал факт', status: 'SUCCESS', raw: { response: 'Записал факт', status: 'SUCCESS' } });
    expect(spawnMock).toHaveBeenCalledWith(
      'agy',
      ['--mode', 'accept-edits', '--output-format', 'json', '--print-timeout', '2m', '-p', 'привет'],
      { cwd: undefined },
    );
  });

  it('rejects with stderr content on non-zero exit', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    child.stderr.emit('data', Buffer.from('auth required'));
    child.emit('close', 1);

    await expect(promise).rejects.toThrow('agy exited with code 1: auth required');
  });

  it('rejects when stdout is not valid JSON', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    child.stdout.emit('data', Buffer.from('not json'));
    child.emit('close', 0);

    await expect(promise).rejects.toThrow('Failed to parse agy output as JSON');
  });

  it('rejects when the process itself fails to spawn', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    child.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow('ENOENT');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/agy/runHeadless.test.ts`
Expected: FAIL — `src/agy/runHeadless.ts` does not exist.

- [ ] **Step 3: Implement `src/agy/runHeadless.ts`**

```ts
import { spawn } from 'node:child_process';

export interface AgyResult {
  response: string;
  status: string;
  raw: unknown;
}

export interface RunHeadlessOptions {
  agyBin: string;
  timeout: string;
  cwd?: string;
}

export function runHeadless(prompt: string, options: RunHeadlessOptions): Promise<AgyResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      options.agyBin,
      ['--mode', 'accept-edits', '--output-format', 'json', '--print-timeout', options.timeout, '-p', prompt],
      { cwd: options.cwd },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`agy exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { response: string; status: string };
        resolve({ response: parsed.response, status: parsed.status, raw: parsed });
      } catch (err) {
        reject(new Error(`Failed to parse agy output as JSON: ${(err as Error).message}\nstdout: ${stdout}`));
      }
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/agy/runHeadless.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agy/runHeadless.ts test/agy/runHeadless.test.ts
git commit -m "feat: spawn agy headless and parse its JSON envelope"
```

---

## Task 10: Prompt builder (tool policy, CLARIFY convention)

**Files:**
- Create: `src/agy/prompts.ts`
- Test: `test/agy/prompts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildMessagePrompt(message: string): string`, `buildClarificationPrompt(originalMessage: string, question: string, answer: string): string`, exported constant `CLARIFY_PREFIX = 'CLARIFY:'`.

This is where the spec's two requirements meet: `agy` decides itself whether a message is a new fact or a question (no brittle keyword heuristics in bot code), and it signals "I need to ask the user something" with a fixed, parseable prefix instead of free-form text the bot would have to guess at.

- [ ] **Step 1: Write the failing tests**

`test/agy/prompts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildMessagePrompt, buildClarificationPrompt, CLARIFY_PREFIX } from '../../src/agy/prompts.js';

describe('buildMessagePrompt', () => {
  it('includes the user message and both fact/question branches', () => {
    const prompt = buildMessagePrompt('Пете нравится зелёный чай');
    expect(prompt).toContain('Пете нравится зелёный чай');
    expect(prompt).toContain('write_fact');
    expect(prompt).toContain('search_entities');
  });

  it('instructs not to dump the whole vault', () => {
    const prompt = buildMessagePrompt('какой чай у Пети');
    expect(prompt.toLowerCase()).toContain('не читай весь vault');
  });

  it('references the CLARIFY convention', () => {
    const prompt = buildMessagePrompt('кто он?');
    expect(prompt).toContain(CLARIFY_PREFIX);
  });
});

describe('buildClarificationPrompt', () => {
  it('includes the original message, the question and the answer', () => {
    const prompt = buildClarificationPrompt('Петя сделал сальто', 'Какой именно Петя?', 'Петя Иванов');
    expect(prompt).toContain('Петя сделал сальто');
    expect(prompt).toContain('Какой именно Петя?');
    expect(prompt).toContain('Петя Иванов');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/agy/prompts.test.ts`
Expected: FAIL — `src/agy/prompts.ts` does not exist.

- [ ] **Step 3: Implement `src/agy/prompts.ts`**

```ts
export const CLARIFY_PREFIX = 'CLARIFY:';

const TOOL_POLICY = `Доступные инструменты: get_schema, list_entities, search_entities, read_entity, write_fact, create_entity, propose_schema_change, apply_schema_change.

Правила:
- Перед записью факта сначала найди существующую сущность через search_entities/list_entities — не создавай дубликат, если сущность уже есть под другим написанием имени.
- Записывай факты только через write_fact или create_entity — никогда не изменяй файлы напрямую.
- Не читай весь vault целиком — используй search_entities/read_entity только для сущностей, релевантных сообщению или вопросу.
- Факты о событии (кто что сделал НА событии) пиши в файл события типа "event" со ссылками [[Имя]] на участников — не дублируй их в файл человека.
- Если стоит вынести повторяющийся факт в YAML-схему или завести новый тип сущности — вызови propose_schema_change и упомяни это в финальном ответе. Никогда не вызывай apply_schema_change сам — это делает только бот по явной команде пользователя.
- Если не хватает информации, чтобы понять, о ком или о чём речь (например, несколько сущностей с похожим именем) — не вызывай больше инструментов и верни ответ СТРОГО в формате "${CLARIFY_PREFIX} <твой уточняющий вопрос>", без ничего лишнего.`;

export function buildMessagePrompt(message: string): string {
  return `${TOOL_POLICY}

Сообщение пользователя: """${message}"""

Сначала определи сам, это новый факт для записи или вопрос о ранее записанных фактах:
- Если это факт — запиши его через write_fact/create_entity и в конце кратко напиши по-русски, что записано.
- Если это вопрос — ответь кратко по-русски, основываясь только на найденных данных. Если данных недостаточно, так и скажи.`;
}

export function buildClarificationPrompt(originalMessage: string, question: string, answer: string): string {
  return `${TOOL_POLICY}

Ранее на сообщение пользователя:
"""${originalMessage}"""
был задан уточняющий вопрос: "${question}"
Пользователь ответил: "${answer}"

Продолжи обработку исходного сообщения с учётом уточнения так же, как описано выше (запись факта или ответ на вопрос).`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/agy/prompts.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agy/prompts.ts test/agy/prompts.test.ts
git commit -m "feat: agy system prompt with tool policy and CLARIFY convention"
```

---

## Task 11: Pending clarification store (1-hour rolling context)

**Files:**
- Create: `src/bot/pendingContext.ts`
- Test: `test/bot/pendingContext.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PendingClarification { chatId: number; originalMessage: string; question: string; createdAt: number }`, `PendingContextStore` class with `set(entry)`, `takeIfFresh(chatId): PendingClarification | null`, `clear(chatId): void`.

- [ ] **Step 1: Write the failing tests**

`test/bot/pendingContext.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PendingContextStore } from '../../src/bot/pendingContext.js';

describe('PendingContextStore', () => {
  it('returns null when nothing is pending for a chat', () => {
    const store = new PendingContextStore(() => 0);
    expect(store.takeIfFresh(1)).toBeNull();
  });

  it('returns and clears a pending entry within the 1-hour window', () => {
    let now = 0;
    const store = new PendingContextStore(() => now);
    store.set({ chatId: 1, originalMessage: 'Петя сделал сальто', question: 'Какой именно Петя?' });

    now = 30 * 60 * 1000; // 30 minutes later
    const entry = store.takeIfFresh(1);
    expect(entry?.question).toBe('Какой именно Петя?');
    expect(store.takeIfFresh(1)).toBeNull(); // consumed
  });

  it('discards an entry older than 1 hour', () => {
    let now = 0;
    const store = new PendingContextStore(() => now);
    store.set({ chatId: 1, originalMessage: 'X', question: 'Y?' });

    now = 61 * 60 * 1000; // 61 minutes later
    expect(store.takeIfFresh(1)).toBeNull();
  });

  it('keeps separate state per chat id', () => {
    const store = new PendingContextStore(() => 0);
    store.set({ chatId: 1, originalMessage: 'X', question: 'Y?' });
    expect(store.takeIfFresh(2)).toBeNull();
    expect(store.takeIfFresh(1)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/bot/pendingContext.test.ts`
Expected: FAIL — `src/bot/pendingContext.ts` does not exist.

- [ ] **Step 3: Implement `src/bot/pendingContext.ts`**

```ts
export interface PendingClarification {
  chatId: number;
  originalMessage: string;
  question: string;
  createdAt: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export class PendingContextStore {
  private pending = new Map<number, PendingClarification>();

  constructor(private now: () => number = Date.now) {}

  set(entry: Omit<PendingClarification, 'createdAt'>): void {
    this.pending.set(entry.chatId, { ...entry, createdAt: this.now() });
  }

  takeIfFresh(chatId: number): PendingClarification | null {
    const entry = this.pending.get(chatId);
    if (!entry) return null;
    this.pending.delete(chatId);
    if (this.now() - entry.createdAt > ONE_HOUR_MS) return null;
    return entry;
  }

  clear(chatId: number): void {
    this.pending.delete(chatId);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/bot/pendingContext.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/bot/pendingContext.ts test/bot/pendingContext.test.ts
git commit -m "feat: 1-hour rolling pending-clarification store"
```

---

## Task 12: Bot pure logic (auth, response interpretation, prompt dispatch)

**Files:**
- Create: `src/bot/auth.ts`
- Create: `src/bot/respond.ts`
- Create: `src/bot/dispatch.ts`
- Test: `test/bot/auth.test.ts`, `test/bot/respond.test.ts`, `test/bot/dispatch.test.ts`

**Interfaces:**
- Consumes: `PendingContextStore` (Task 11), `buildMessagePrompt`/`buildClarificationPrompt`/`CLARIFY_PREFIX` (Task 10).
- Produces: `isAuthorized(fromId, allowedTelegramId): boolean`; `ResponseAction { kind: 'reply' | 'clarify'; text: string }`, `interpretAgyResponse(response): ResponseAction`; `buildPromptForMessage(chatId, text, pending): string`.

- [ ] **Step 1: Write the failing test for auth**

`test/bot/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isAuthorized } from '../../src/bot/auth.js';

describe('isAuthorized', () => {
  it('allows the configured id', () => {
    expect(isAuthorized(42, 42)).toBe(true);
  });
  it('rejects any other id', () => {
    expect(isAuthorized(1, 42)).toBe(false);
  });
  it('rejects undefined (no from field)', () => {
    expect(isAuthorized(undefined, 42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails, then implement `src/bot/auth.ts`**

Run: `npx vitest run test/bot/auth.test.ts` → FAIL (file missing).

```ts
export function isAuthorized(fromId: number | undefined, allowedTelegramId: number): boolean {
  return fromId === allowedTelegramId;
}
```

Run again → PASS (3 tests).

- [ ] **Step 3: Write the failing test for response interpretation**

`test/bot/respond.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { interpretAgyResponse } from '../../src/bot/respond.js';

describe('interpretAgyResponse', () => {
  it('treats a CLARIFY-prefixed response as a clarification request', () => {
    const action = interpretAgyResponse('CLARIFY: Какой именно Петя?');
    expect(action).toEqual({ kind: 'clarify', text: 'Какой именно Петя?' });
  });

  it('treats any other response as a final reply', () => {
    const action = interpretAgyResponse('Записал: Пете нравится зелёный чай.');
    expect(action).toEqual({ kind: 'reply', text: 'Записал: Пете нравится зелёный чай.' });
  });
});
```

- [ ] **Step 4: Run it, verify it fails, then implement `src/bot/respond.ts`**

Run: `npx vitest run test/bot/respond.test.ts` → FAIL (file missing).

```ts
import { CLARIFY_PREFIX } from '../agy/prompts.js';

export interface ResponseAction {
  kind: 'reply' | 'clarify';
  text: string;
}

export function interpretAgyResponse(response: string): ResponseAction {
  if (response.startsWith(CLARIFY_PREFIX)) {
    return { kind: 'clarify', text: response.slice(CLARIFY_PREFIX.length).trim() };
  }
  return { kind: 'reply', text: response };
}
```

Run again → PASS (2 tests).

- [ ] **Step 5: Write the failing test for prompt dispatch**

`test/bot/dispatch.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PendingContextStore } from '../../src/bot/pendingContext.js';
import { buildPromptForMessage } from '../../src/bot/dispatch.js';

describe('buildPromptForMessage', () => {
  it('builds a fresh message prompt when nothing is pending', () => {
    const pending = new PendingContextStore(() => 0);
    const prompt = buildPromptForMessage(1, 'Пете нравится чай', pending);
    expect(prompt).toContain('Пете нравится чай');
  });

  it('builds a clarification prompt when an unanswered question is pending and fresh', () => {
    const pending = new PendingContextStore(() => 0);
    pending.set({ chatId: 1, originalMessage: 'Петя сделал сальто', question: 'Какой именно Петя?' });
    const prompt = buildPromptForMessage(1, 'Петя Иванов', pending);
    expect(prompt).toContain('Петя сделал сальто');
    expect(prompt).toContain('Какой именно Петя?');
    expect(prompt).toContain('Петя Иванов');
  });
});
```

- [ ] **Step 6: Run it, verify it fails, then implement `src/bot/dispatch.ts`**

Run: `npx vitest run test/bot/dispatch.test.ts` → FAIL (file missing).

```ts
import { PendingContextStore } from './pendingContext.js';
import { buildMessagePrompt, buildClarificationPrompt } from '../agy/prompts.js';

export function buildPromptForMessage(chatId: number, text: string, pending: PendingContextStore): string {
  const pendingEntry = pending.takeIfFresh(chatId);
  if (pendingEntry) {
    return buildClarificationPrompt(pendingEntry.originalMessage, pendingEntry.question, text);
  }
  return buildMessagePrompt(text);
}
```

Run again → PASS (2 tests).

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: all tests across all tasks so far PASS.

- [ ] **Step 8: Commit**

```bash
git add src/bot/auth.ts src/bot/respond.ts src/bot/dispatch.ts test/bot/auth.test.ts test/bot/respond.test.ts test/bot/dispatch.test.ts
git commit -m "feat: bot auth check, agy response interpretation, prompt dispatch"
```

---

## Task 13: Telegram bot wiring and entrypoint

**Files:**
- Create: `src/bot/index.ts`
- Create: `src/index.ts`
- Modify: `package.json` (no changes needed beyond Task 1 — confirm `start` script already points at `dist/index.js`)

**Interfaces:**
- Consumes: `Config` (Task 1), `runHeadless` (Task 9), `isAuthorized`/`interpretAgyResponse`/`buildPromptForMessage`/`PendingContextStore` (Tasks 11-12), `getProposal`/`deleteProposal` (Task 6), `applySchemaChange` (Task 7).
- Produces: `createBot(config: Config): Bot` (grammY instance), and the process entrypoint.

This task wires network I/O (Telegram) together with a real `agy` subprocess call — it is **not** unit-tested with mocks, per the spec's testing section; it is verified manually against a real bot in Step 3, the same way the spec treats all Telegram/agy/Google Drive integration.

- [ ] **Step 1: Implement `src/bot/index.ts`**

```ts
import { Bot } from 'grammy';
import type { Config } from '../config.js';
import { runHeadless } from '../agy/runHeadless.js';
import { isAuthorized } from './auth.js';
import { interpretAgyResponse } from './respond.js';
import { PendingContextStore } from './pendingContext.js';
import { buildPromptForMessage } from './dispatch.js';
import { getProposal, deleteProposal } from '../vault/schemaProposals.js';
import { applySchemaChange } from '../vault/applySchemaChange.js';

export function createBot(config: Config): Bot {
  const bot = new Bot(config.telegramBotToken);
  const pending = new PendingContextStore();

  bot.use(async (ctx, next) => {
    if (!isAuthorized(ctx.from?.id, config.allowedTelegramId)) return;
    await next();
  });

  bot.command('confirm_schema', async (ctx) => {
    const id = ctx.match.trim();
    const proposal = await getProposal(config.vaultPath, id);
    if (!proposal) {
      await ctx.reply(`Предложение ${id} не найдено.`);
      return;
    }
    const result = await applySchemaChange(config.vaultPath, proposal);
    await deleteProposal(config.vaultPath, id);
    await ctx.reply(`Применено. Обновлённые файлы: ${result.updatedFiles.join(', ') || '—'}`);
  });

  bot.command('cancel_schema', async (ctx) => {
    const id = ctx.match.trim();
    await deleteProposal(config.vaultPath, id);
    await ctx.reply(`Предложение ${id} отменено.`);
  });

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    const prompt = buildPromptForMessage(chatId, ctx.message.text, pending);
    try {
      const result = await runHeadless(prompt, { agyBin: config.agyBin, timeout: config.agyTimeout });
      const action = interpretAgyResponse(result.response);
      if (action.kind === 'clarify') {
        pending.set({ chatId, originalMessage: ctx.message.text, question: action.text });
      }
      await ctx.reply(action.text);
    } catch (err) {
      await ctx.reply(`Ошибка: ${(err as Error).message}. Попробуйте ещё раз.`);
    }
  });

  return bot;
}
```

- [ ] **Step 2: Implement `src/index.ts`**

```ts
import { loadConfig } from './config.js';
import { createBot } from './bot/index.js';

const config = loadConfig();
const bot = createBot(config);
bot.start();
```

- [ ] **Step 3: Build and manually verify against a real bot**

Run: `npm run build`

Create a throwaway bot via `@BotFather` in Telegram for this test, then:
```bash
TELEGRAM_BOT_TOKEN=<test-token> \
ALLOWED_TELEGRAM_ID=<your-telegram-id> \
VAULT_PATH=/tmp/mk-smoke-vault \
AGY_BIN=agy \
node dist/index.js
```
Expected:
- A message from your own Telegram account reaches the bot and gets a reply.
- A message sent from a second, non-whitelisted Telegram account gets no reply at all.
- `/confirm_schema does-not-exist` replies "Предложение does-not-exist не найдено."

- [ ] **Step 4: Commit**

```bash
git add src/bot/index.ts src/index.ts
git commit -m "feat: wire grammY bot to agy, schema commands, and clarification flow"
```

---

## Task 14: Docker packaging

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/entrypoint.sh`
- Create: `docker/mcp_config.json`
- Create: `docker/docker-compose.yml`

**Interfaces:**
- Consumes: the built `dist/` output from Tasks 1-13.
- Produces: a runnable container image for the bot, MCP server and `agy`.

- [ ] **Step 1: Discover the current `agy` install method**

The exact install command changed when Google retired `gemini-cli` in favor of Antigravity CLI, and this plan cannot access the live internet to confirm the current one-liner. Before writing the Dockerfile's install line, run one of these and note the actual command/asset name:

```bash
curl -fsSL https://antigravity.google/docs/cli/ | grep -iE 'curl|install|download' -A3
```
or check the latest release assets directly:
```bash
curl -fsSL https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest | grep -i browser_download_url
```
Expected: either an official one-line installer command, or a concrete Linux binary asset URL — use whichever you find in Step 2 below in place of the placeholder line marked `# CONFIRM`.

- [ ] **Step 2: Create `docker/Dockerfile`**

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV HOME=/root
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/*
# CONFIRM: replace with the command found in Task 14 Step 1
RUN curl -fsSL -o /usr/local/bin/agy \
      "https://github.com/google-antigravity/antigravity-cli/releases/latest/download/agy-linux-amd64" \
    && chmod +x /usr/local/bin/agy
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY docker/mcp_config.json /root/.gemini/antigravity-cli/mcp_config.json
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Create `docker/mcp_config.json`**

```json
{
  "mcpServers": {
    "memory-keeper-vault": {
      "command": "node",
      "args": ["/app/dist/mcp/server.js"],
      "env": { "VAULT_PATH": "/vault" }
    }
  }
}
```

- [ ] **Step 4: Create `docker/entrypoint.sh`**

```sh
#!/bin/sh
set -e

if ! mountpoint -q "$VAULT_PATH" 2>/dev/null && [ -z "$(ls -A "$VAULT_PATH" 2>/dev/null)" ]; then
  echo "VAULT_PATH ($VAULT_PATH) is empty or not mounted — refusing to start until the host mount is ready." >&2
  exit 1
fi

exec "$@"
```

- [ ] **Step 5: Create `docker/docker-compose.yml`**

```yaml
services:
  bot:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    restart: unless-stopped
    environment:
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      ALLOWED_TELEGRAM_ID: ${ALLOWED_TELEGRAM_ID}
      VAULT_PATH: /vault
      AGY_BIN: agy
      AGY_TIMEOUT: 2m
    volumes:
      - /mnt/memory-vault:/vault
      - agy-auth:/root/.gemini/antigravity-cli

volumes:
  agy-auth:
```

Note: `agy-auth` is a named volume, not a bind mount, specifically so Docker's first-run behavior (copying the image's existing directory contents into a fresh named volume) seeds it with the baked-in `mcp_config.json` from Step 3 — after that, `agy`'s own `settings.json` (written by `agy auth login`, see Task 15) lives alongside it and both persist across container recreation.

- [ ] **Step 6: Build the image and sanity-check it**

Run (on a machine with a `/mnt/memory-vault`-like directory, e.g. `mkdir -p /tmp/fake-vault && export VAULT_PATH_HOST=/tmp/fake-vault`):
```bash
docker compose -f docker/docker-compose.yml build
```
Expected: image builds without errors (this validates the Step 1/2 install line actually works — if it fails, revisit Step 1's discovery).

- [ ] **Step 7: Commit**

```bash
git add docker/Dockerfile docker/entrypoint.sh docker/mcp_config.json docker/docker-compose.yml
git commit -m "feat: Docker packaging for bot + MCP server + agy"
```

---

## Task 15: Host deployment (rclone mount + systemd + first agy login)

**Files:**
- Create: `deploy/memory-vault-mount.service`
- Create: `deploy/memory-keeper.service`
- Create: `.env.example`

**Interfaces:**
- Consumes: the Docker setup from Task 14.
- Produces: a running system on the VPS; resolves the spec's flagged open question about `agy` headless auth.

- [ ] **Step 1: Create `.env.example`**

```
TELEGRAM_BOT_TOKEN=
ALLOWED_TELEGRAM_ID=
```

- [ ] **Step 2: Create `deploy/memory-vault-mount.service`**

```ini
[Unit]
Description=Mount MemoryKeeper Google Drive vault via rclone
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStartPre=/bin/mkdir -p /mnt/memory-vault
ExecStart=/usr/bin/rclone mount gdrive:MemoryVault /mnt/memory-vault --vfs-cache-mode writes --allow-other
ExecStop=/bin/fusermount -u /mnt/memory-vault
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Create `deploy/memory-keeper.service`**

```ini
[Unit]
Description=MemoryKeeper Telegram bot (docker compose)
Requires=memory-vault-mount.service
After=memory-vault-mount.service docker.service
BindsTo=memory-vault-mount.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/memory-keeper
ExecStart=/usr/bin/docker compose -f docker/docker-compose.yml up -d
ExecStop=/usr/bin/docker compose -f docker/docker-compose.yml down

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Configure rclone on the VPS**

Run: `rclone config` and follow the prompts to add a remote named `gdrive` of type Google Drive, completing the OAuth flow (this needs a browser — either run it on a machine with one and copy the resulting config to the VPS's `~/.config/rclone/rclone.conf`, or use `rclone authorize` with an SSH tunnel).

- [ ] **Step 5: Install and enable the mount service**

Run:
```bash
sudo cp deploy/memory-vault-mount.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now memory-vault-mount.service
mountpoint /mnt/memory-vault
```
Expected: `mountpoint` reports `/mnt/memory-vault is a mountpoint`.

- [ ] **Step 6: One-time `agy` login on the headless VPS**

Run, from your local machine:
```bash
ssh -L 8085:localhost:8085 <user>@<vps-host>
```
Then, inside that SSH session on the VPS:
```bash
agy auth login
```
Open the URL it prints in your local browser (the SSH `-L` forward makes the OAuth callback on `localhost:8085` reach the VPS-side listener) and complete sign-in with the Google account tied to your AI Pro/Ultra subscription.

- [ ] **Step 7: Verify the flagged open question — does headless work without `GEMINI_API_KEY`?**

Run on the VPS, outside Docker, right after Step 6:
```bash
agy --output-format json -p "скажи привет одним словом"
```
- If this succeeds and prints a JSON envelope with a `response` field: the Pro/Ultra account login is sufficient for headless use — proceed to Step 8 as planned.
- If it instead errors asking for `GEMINI_API_KEY` or billing: stop and choose a fallback before continuing — either (a) obtain a pay-as-you-go Gemini API key and add `GEMINI_API_KEY=...` to the container's environment (requires changing `runHeadless`'s invocation to also pass `env`, a small follow-up change to Task 9), or (b) run `agy` interactively inside a `tmux`/`screen` session on the VPS and adapt `runHeadless` to write to its stdin instead of spawning a fresh process per call — this is a materially different implementation of Task 9 and should be scoped as its own follow-up task if it's needed, not squeezed into this one.

- [ ] **Step 8: Deploy and verify end-to-end**

Run:
```bash
sudo mkdir -p /opt/memory-keeper
# copy the repository to /opt/memory-keeper (git clone or rsync)
cd /opt/memory-keeper
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN and ALLOWED_TELEGRAM_ID
sudo cp deploy/memory-keeper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now memory-keeper.service
docker compose -f docker/docker-compose.yml logs -f
```
Then, from Telegram (your own account):
1. Send "Пете нравится зелёный чай, горячий, без молока и сахара" → expect a reply confirming the fact was recorded, and the corresponding file appears in Google Drive / Obsidian under `People/Петя.md`.
2. Send "какой чай у Пети?" → expect a reply naming the tea preference.
3. Send a message about a person with an ambiguous name shared by two existing entities → expect a `CLARIFY`-driven question back, then reply with the disambiguating name and confirm it completes the original request.
4. Wait over an hour (or temporarily lower the 1-hour constant in `pendingContext.ts` for this one manual check) and reply to an old clarification question → expect it to be treated as a brand-new, unrelated message.

- [ ] **Step 9: Commit**

```bash
git add deploy/memory-vault-mount.service deploy/memory-keeper.service .env.example
git commit -m "feat: host deployment units for rclone mount and dockerized bot"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — schema (Task 2), entity files (Task 3), facts incl. YAML promotion (Task 4), search (Task 5), schema proposals incl. no-TTL (Task 6), deterministic apply (Task 7), MCP tool table (Task 8), `agy` invocation without `--resume` (Task 9), tool policy + CLARIFY convention replacing the undefined "how does the bot know it's a question" gap found while planning (Task 10), 1-hour clarification window (Task 11), auth/dispatch (Task 12), Telegram wiring (Task 13), Docker with rclone kept on the host (Task 14), systemd + the flagged Pro/Ultra-vs-API-key verification (Task 15).
- **Fixed during planning:** the spec described "ingestion" and "query" as separate pipelines but never specified how the bot tells them apart from a raw Telegram message; Task 10/12 resolve this by having `agy` itself decide via a single unified prompt, rather than a fragile keyword heuristic in bot code.
- **Type consistency checked:** `EntityFile`/`VaultSchema`/`RelatedEntity`/`SchemaProposal`/`SchemaChange`/`Config`/`AgyResult`/`PendingClarification` are defined once (Tasks 1-2-3-4-6-9-11) and referenced with the same shape in every later task that imports them.
- **Known external uncertainty, flagged rather than guessed:** the exact `agy` Linux install command/asset (Task 14 Step 1) and whether headless mode honors the Pro/Ultra account login vs requiring `GEMINI_API_KEY` (Task 15 Step 7) are both genuinely unverifiable without live access to the current VPS/CLI — each has a concrete discovery step and a concrete fallback, not a vague TODO.
