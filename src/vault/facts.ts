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
