import { readSchema } from '../vault/schema.js';
import { listAllEntities, readEntity, writeEntity } from '../vault/entity.js';
import { searchEntities } from '../vault/search.js';
import { upsertFact, type RelatedEntity } from '../vault/facts.js';
import { saveProposal, type SchemaChange } from '../vault/schemaProposals.js';
import type { EntityFile, VaultSchema } from '../vault/types.js';

function emptyEntity(type: string, name: string): EntityFile {
  return { type, name, frontmatter: { type, aliases: [] }, factLines: [], notes: '', extraContent: '' };
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

function withAlias(aliases: string[], alias: string): string[] {
  const trimmed = alias.trim();
  if (!trimmed || aliases.includes(trimmed)) return aliases;
  return [...aliases, trimmed];
}

/**
 * Creates the entity, or — if it already exists — merges `fields` into its
 * existing frontmatter (incoming values win on conflict) without touching its
 * facts, notes or any other hand-written content. `type` cannot be overridden,
 * and an `aliases` field is appended as one alias instead of replacing the array.
 */
export async function createEntity(
  vaultPath: string,
  type: string,
  name: string,
  fields: Record<string, string> = {},
): Promise<{ message: string }> {
  const schema = await readSchema(vaultPath);
  const existing = await readEntity(vaultPath, schema, type, name);
  const entity = existing ?? emptyEntity(type, name);
  const otherFields = Object.fromEntries(
    Object.entries(fields).filter(([key]) => key !== 'type' && key !== 'aliases'),
  );
  const aliases =
    fields.aliases === undefined ? entity.frontmatter.aliases : withAlias(entity.frontmatter.aliases, fields.aliases);
  entity.frontmatter = { ...entity.frontmatter, ...otherFields, type, aliases };
  await writeEntity(vaultPath, schema, entity);
  return { message: existing ? `Обновлено (уже существовало): ${type}/${name}` : `Создано: ${type}/${name}` };
}

export async function addAlias(
  vaultPath: string,
  type: string,
  name: string,
  alias: string,
): Promise<{ message: string }> {
  const trimmed = alias.trim();
  if (!trimmed) return { message: 'Пустой алиас — ничего не добавлено' };
  const schema = await readSchema(vaultPath);
  const entity = (await readEntity(vaultPath, schema, type, name)) ?? emptyEntity(type, name);
  if (entity.frontmatter.aliases.includes(trimmed)) {
    return { message: `Алиас «${trimmed}» уже есть у ${type}/${name}` };
  }
  const aliases = withAlias(entity.frontmatter.aliases, trimmed);
  await writeEntity(vaultPath, schema, { ...entity, frontmatter: { ...entity.frontmatter, aliases } });
  return { message: `Добавлен алиас «${trimmed}» для ${type}/${name}` };
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

// NOTE: there is deliberately no apply-schema-change handler here. Applying a
// proposal is NOT exposed to agy over MCP — it happens only in the bot's
// /confirm_schema command (src/bot/index.ts), after explicit user confirmation.
