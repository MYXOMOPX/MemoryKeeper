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
