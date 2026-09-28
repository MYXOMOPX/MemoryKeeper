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
