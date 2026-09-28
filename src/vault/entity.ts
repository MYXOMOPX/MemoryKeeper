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
