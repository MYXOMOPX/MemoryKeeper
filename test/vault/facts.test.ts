import { describe, it, expect } from 'vitest';
import { upsertFact } from '../../src/vault/facts.js';
import { defaultSchema } from '../../src/vault/schema.js';
import type { EntityFile, VaultSchema } from '../../src/vault/types.js';

function person(): EntityFile {
  return { type: 'person', name: 'Петя', frontmatter: { type: 'person', aliases: [] }, factLines: [], notes: '', extraContent: '' };
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
