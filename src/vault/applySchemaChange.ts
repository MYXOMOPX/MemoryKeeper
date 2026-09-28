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
