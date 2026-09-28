import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { defaultSchema } from '../../src/vault/schema.js';
import { readEntity, writeEntity, listEntityFiles, listAllEntities } from '../../src/vault/entity.js';
import type { EntityFile } from '../../src/vault/types.js';

describe('entity read/write', () => {
  let vaultPath: string;
  const schema = defaultSchema();

  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('returns null for a missing entity', async () => {
    expect(await readEntity(vaultPath, schema, 'person', 'Петя Иванов')).toBeNull();
  });

  it('round-trips an entity through write and read', async () => {
    const entity: EntityFile = {
      type: 'person',
      name: 'Петя Иванов',
      frontmatter: { type: 'person', aliases: ['Петя'] },
      factLines: ['- Первая девушка: [[Яна Сергеева]] _(добавлено 2026-09-19)_'],
      notes: 'Любит late-night звонки.',
    };
    await writeEntity(vaultPath, schema, entity);
    const reloaded = await readEntity(vaultPath, schema, 'person', 'Петя Иванов');
    expect(reloaded?.frontmatter.aliases).toEqual(['Петя']);
    expect(reloaded?.factLines).toEqual(entity.factLines);
    expect(reloaded?.notes).toBe('Любит late-night звонки.');
  });

  it('lists entity file names for a type, empty when folder is absent', async () => {
    expect(await listEntityFiles(vaultPath, schema, 'person')).toEqual([]);
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Яна Сергеева',
      frontmatter: { type: 'person', aliases: [] },
      factLines: [],
      notes: '',
    });
    expect(await listEntityFiles(vaultPath, schema, 'person')).toEqual(['Яна Сергеева']);
  });

  it('lists all entities across all types', async () => {
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Петя Иванов',
      frontmatter: { type: 'person', aliases: [] },
      factLines: [],
      notes: '',
    });
    await writeEntity(vaultPath, schema, {
      type: 'event',
      name: 'ДР у Кати 2026-09-20',
      frontmatter: { type: 'event', aliases: [], date: '2026-09-20' },
      factLines: [],
      notes: '',
    });
    const all = await listAllEntities(vaultPath, schema);
    expect(all.map((e) => e.name).sort()).toEqual(['ДР у Кати 2026-09-20', 'Петя Иванов']);
  });
});
