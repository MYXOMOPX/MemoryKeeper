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
