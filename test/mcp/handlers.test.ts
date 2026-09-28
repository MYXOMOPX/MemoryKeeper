import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import * as handlers from '../../src/mcp/handlers.js';

describe('mcp handlers', () => {
  let vaultPath: string;
  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('getSchema returns the bootstrapped default schema', async () => {
    const schema = await handlers.getSchema(vaultPath);
    expect(schema.types.person.folder).toBe('People');
  });

  it('writeFact creates a new entity when it does not exist', async () => {
    const result = await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'зелёный');
    expect(result.message).toContain('Петя');
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.factLines[0]).toContain('зелёный');
  });

  it('writeFact updates an existing entity instead of duplicating the fact', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'чёрный');
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'зелёный');
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.factLines).toHaveLength(1);
    expect(entity?.factLines[0]).toContain('зелёный');
  });

  it('createEntity sets initial frontmatter fields', async () => {
    await handlers.createEntity(vaultPath, 'event', 'ДР у Кати', { date: '2026-09-20' });
    const entity = await handlers.readEntityHandler(vaultPath, 'event', 'ДР у Кати');
    expect(entity?.frontmatter.date).toBe('2026-09-20');
  });

  it('searchEntitiesHandler finds entities written via writeFact', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя Иванов', 'Любимый чай', 'зелёный');
    const results = await handlers.searchEntitiesHandler(vaultPath, 'Иванов');
    expect(results).toEqual([{ type: 'person', name: 'Петя Иванов' }]);
  });

  it('listEntities filters by type', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'X', 'Y');
    await handlers.createEntity(vaultPath, 'event', 'ДР у Кати', {});
    const persons = await handlers.listEntities(vaultPath, 'person');
    expect(persons.map((e) => e.name)).toEqual(['Петя']);
  });

  it('proposeSchemaChange then applySchemaChangeHandler promotes the field', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'зелёный');
    const { id } = await handlers.proposeSchemaChange(vaultPath, 'Вынести чай', {
      kind: 'promote_field',
      entityType: 'person',
      factKey: 'Любимый чай',
    });
    const applied = await handlers.applySchemaChangeHandler(vaultPath, id);
    expect(applied.message).toContain('Петя');
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.frontmatter['Любимый чай']).toBe('зелёный');
  });

  it('applySchemaChangeHandler reports a missing proposal instead of throwing', async () => {
    const result = await handlers.applySchemaChangeHandler(vaultPath, 'does-not-exist');
    expect(result.message).toContain('не найдено');
  });
});
