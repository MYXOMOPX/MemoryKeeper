import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import * as handlers from '../../src/mcp/handlers.js';
import { getProposal, deleteProposal } from '../../src/vault/schemaProposals.js';
import { applySchemaChange } from '../../src/vault/applySchemaChange.js';

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

  it('createEntity on an existing entity merges fields and preserves facts written via writeFact', async () => {
    await handlers.createEntity(vaultPath, 'person', 'Петя', { nickname: 'Петруха' });
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'зелёный');
    await handlers.addAlias(vaultPath, 'person', 'Петя', 'Пётр');
    const result = await handlers.createEntity(vaultPath, 'person', 'Петя', { city: 'Москва' });
    expect(result.message).toContain('уже существовало');

    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.factLines).toHaveLength(1);
    expect(entity?.factLines[0]).toContain('Любимый чай: зелёный');
    expect(entity?.frontmatter.nickname).toBe('Петруха');
    expect(entity?.frontmatter.city).toBe('Москва');
    expect(entity?.frontmatter.aliases).toEqual(['Пётр']);
    expect(entity?.frontmatter.type).toBe('person');
  });

  it('createEntity treats an "aliases" field as one appended alias, never as a string', async () => {
    await handlers.createEntity(vaultPath, 'person', 'Петя', { aliases: 'Петруха' });
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.frontmatter.aliases).toEqual(['Петруха']);
  });

  it('addAlias appends an alias to an existing entity as an array, deduped, keeping its facts', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя Иванов', 'Любимый чай', 'зелёный');
    await handlers.addAlias(vaultPath, 'person', 'Петя Иванов', 'Петя');
    await handlers.addAlias(vaultPath, 'person', 'Петя Иванов', 'Петруха');
    const dup = await handlers.addAlias(vaultPath, 'person', 'Петя Иванов', 'Петя');
    expect(dup.message).toContain('уже есть');

    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя Иванов');
    expect(entity?.frontmatter.aliases).toEqual(['Петя', 'Петруха']);
    expect(entity?.factLines[0]).toContain('Любимый чай: зелёный');

    // The alias is actually usable for lookup.
    const found = await handlers.searchEntitiesHandler(vaultPath, 'Петруха');
    expect(found).toEqual([{ type: 'person', name: 'Петя Иванов' }]);
  });

  it('addAlias creates the entity when it does not exist yet', async () => {
    await handlers.addAlias(vaultPath, 'person', 'Яна Сергеева', 'Яна');
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Яна Сергеева');
    expect(entity?.frontmatter.aliases).toEqual(['Яна']);
  });

  it('does not expose any handler that applies a schema change (only /confirm_schema may)', () => {
    expect(Object.keys(handlers).some((name) => /apply/i.test(name))).toBe(false);
  });

  it('proposeSchemaChange then the /confirm_schema path (getProposal + applySchemaChange) promotes the field', async () => {
    await handlers.writeFact(vaultPath, 'person', 'Петя', 'Любимый чай', 'зелёный');
    const { id } = await handlers.proposeSchemaChange(vaultPath, 'Вынести чай', {
      kind: 'promote_field',
      entityType: 'person',
      factKey: 'Любимый чай',
    });

    // Proposing alone must not change anything.
    const before = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(before?.frontmatter['Любимый чай']).toBeUndefined();

    // Same steps as the bot's /confirm_schema command in src/bot/index.ts.
    const proposal = await getProposal(vaultPath, id);
    expect(proposal).not.toBeNull();
    const result = await applySchemaChange(vaultPath, proposal!);
    await deleteProposal(vaultPath, id);

    expect(result.updatedFiles).toEqual(['Петя']);
    const entity = await handlers.readEntityHandler(vaultPath, 'person', 'Петя');
    expect(entity?.frontmatter['Любимый чай']).toBe('зелёный');
    expect(await getProposal(vaultPath, id)).toBeNull();
  });
});
