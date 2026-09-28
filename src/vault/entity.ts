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

const NO_FACTS_PLACEHOLDER = '(пока нет фактов)';
// A level-1 or level-2 markdown heading ends the `## Факты` block.
const SECTION_HEADING = /^#{1,2}\s/;

export function serializeEntity(entity: EntityFile): string {
  const extra = entity.extraContent.trim() ? [entity.extraContent, ''] : [];
  const body = [
    ...extra,
    FACTS_HEADING,
    ...(entity.factLines.length > 0 ? entity.factLines : [NO_FACTS_PLACEHOLDER]),
    '',
    NOTES_HEADING,
    entity.notes,
  ].join('\n');
  return matter.stringify(body, entity.frontmatter);
}

function formatYamlDate(date: Date): string {
  const iso = date.toISOString();
  // YAML `2026-09-20` parses to midnight UTC: write it back as the plain date it was.
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/**
 * gray-matter's YAML engine turns unquoted date-like values (`date: 2026-09-20`)
 * into JS Date objects, which would be re-serialized as `2026-09-20T00:00:00.000Z`.
 * Convert them back to strings so frontmatter round-trips unchanged.
 */
function normalizeYamlValue(value: unknown): unknown {
  if (value instanceof Date) return formatYamlDate(value);
  if (Array.isArray(value)) return value.map(normalizeYamlValue);
  return value;
}

function normalizeAliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((a): a is string => typeof a === 'string');
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

/** Drops leading blank lines and trailing whitespace, keeping everything else verbatim. */
function trimBlankEdges(text: string): string {
  return text.replace(/^\s*\n/, '').trimEnd();
}

export function parseEntity(raw: string, type: string, name: string): EntityFile {
  const parsed = matter(raw);
  const lines = parsed.content.split('\n');

  // Single pass: text before `## Факты`, and any other `#`/`##` section outside
  // the two managed blocks, goes to extraContent. Everything after `## Заметки`
  // (to EOF) is notes, as before.
  const extra: string[] = [];
  const facts: string[] = [];
  const notes: string[] = [];
  let section: 'extra' | 'facts' | 'notes' = 'extra';
  for (const line of lines) {
    const trimmed = line.trim();
    if (section !== 'notes') {
      if (trimmed === FACTS_HEADING) {
        section = 'facts';
        continue;
      }
      if (trimmed === NOTES_HEADING) {
        section = 'notes';
        continue;
      }
      if (section === 'facts' && SECTION_HEADING.test(trimmed)) section = 'extra';
    }
    if (section === 'extra') extra.push(line);
    else if (section === 'facts') facts.push(line);
    else notes.push(line);
  }

  // Keep every non-blank line of the facts block (bullets, but also any
  // hand-written prose or continuation lines) except our own placeholder.
  const factLines = facts.filter((l) => l.trim() !== '' && l.trim() !== NO_FACTS_PLACEHOLDER);

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) data[key] = normalizeYamlValue(value);

  return {
    type,
    name,
    frontmatter: { type, ...data, aliases: normalizeAliases(data.aliases) } as EntityFile['frontmatter'],
    factLines,
    notes: notes.join('\n').trim(),
    extraContent: trimBlankEdges(extra.join('\n')),
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
