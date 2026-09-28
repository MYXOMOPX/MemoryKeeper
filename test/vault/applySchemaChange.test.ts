import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { readSchema } from '../../src/vault/schema.js';
import { writeEntity, readEntity } from '../../src/vault/entity.js';
import { applySchemaChange } from '../../src/vault/applySchemaChange.js';
import type { SchemaProposal } from '../../src/vault/schemaProposals.js';

describe('applySchemaChange', () => {
  let vaultPath: string;
  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('adds a new entity type to the schema', async () => {
    const schema = await readSchema(vaultPath);
    const proposal: SchemaProposal = {
      id: '1',
      createdAt: new Date().toISOString(),
      description: 'Add places',
      change: { kind: 'new_type', typeName: 'place', folder: 'Places', structuredFields: [] },
    };
    const result = await applySchemaChange(vaultPath, proposal);
    expect(result.updatedFiles).toEqual([]);
    const reloaded = await readSchema(vaultPath);
    expect(reloaded.types.place).toEqual({ folder: 'Places', structuredFields: [] });
    void schema;
  });

  it('promotes a fact key to frontmatter across every matching entity file', async () => {
    const schema = await readSchema(vaultPath);
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Петя',
      frontmatter: { type: 'person', aliases: [] },
      factLines: ['- Любимый чай: зелёный _(добавлено 2026-09-19)_'],
      notes: '',
      extraContent: '',
    });
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Яна',
      frontmatter: { type: 'person', aliases: [] },
      factLines: ['- Рост: 165 _(добавлено 2026-09-19)_'],
      notes: '',
      extraContent: '',
    });

    const proposal: SchemaProposal = {
      id: '2',
      createdAt: new Date().toISOString(),
      description: 'Promote tea preference',
      change: { kind: 'promote_field', entityType: 'person', factKey: 'Любимый чай' },
    };
    const result = await applySchemaChange(vaultPath, proposal);
    expect(result.updatedFiles).toEqual(['Петя']);

    const petya = await readEntity(vaultPath, await readSchema(vaultPath), 'person', 'Петя');
    expect(petya?.frontmatter['Любимый чай']).toBe('зелёный');
    expect(petya?.factLines).toEqual([]);

    const yana = await readEntity(vaultPath, await readSchema(vaultPath), 'person', 'Яна');
    expect(yana?.factLines).toEqual(['- Рост: 165 _(добавлено 2026-09-19)_']);

    const reloadedSchema = await readSchema(vaultPath);
    expect(reloadedSchema.types.person.structuredFields).toContain('Любимый чай');
  });

  it('strips wikilinks when promoting a fact key with linked entities to frontmatter', async () => {
    const schema = await readSchema(vaultPath);
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Максим',
      frontmatter: { type: 'person', aliases: [] },
      factLines: ['- Первая девушка: Яна [[Яна Сергеева]] _(добавлено 2026-09-19)_'],
      notes: '',
      extraContent: '',
    });

    const proposal: SchemaProposal = {
      id: '3',
      createdAt: new Date().toISOString(),
      description: 'Promote first girlfriend',
      change: { kind: 'promote_field', entityType: 'person', factKey: 'Первая девушка' },
    };
    const result = await applySchemaChange(vaultPath, proposal);
    expect(result.updatedFiles).toEqual(['Максим']);

    const maxim = await readEntity(vaultPath, await readSchema(vaultPath), 'person', 'Максим');
    expect(maxim?.frontmatter['Первая девушка']).toBe('Яна');
    expect(maxim?.factLines).toEqual([]);
  });

  it('throws on new_type when the type name already exists, without modifying the schema', async () => {
    const before = await readSchema(vaultPath);
    const existingPersonFolder = before.types.person.folder;

    const proposal: SchemaProposal = {
      id: '4',
      createdAt: new Date().toISOString(),
      description: 'Collide with person',
      change: { kind: 'new_type', typeName: 'person', folder: 'ClobberedFolder', structuredFields: [] },
    };

    await expect(applySchemaChange(vaultPath, proposal)).rejects.toThrow(
      'Entity type "person" already exists',
    );

    const after = await readSchema(vaultPath);
    expect(after.types.person.folder).toBe(existingPersonFolder);
  });
});
