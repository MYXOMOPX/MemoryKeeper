import type { EntityFile } from './types.js';

function aliasesOf(entity: EntityFile): string[] {
  const aliases: unknown = entity.frontmatter.aliases;
  // Defensive: a hand-edited `aliases: Петя` is a string; never spread it into characters.
  if (typeof aliases === 'string') return [entity.name, aliases];
  return [entity.name, ...(Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === 'string') : [])];
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
