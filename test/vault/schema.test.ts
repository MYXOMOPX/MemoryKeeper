import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { readSchema, writeSchema, defaultSchema, schemaFilePath } from '../../src/vault/schema.js';

describe('vault schema', () => {
  let vaultPath: string;

  afterEach(async () => {
    if (vaultPath) await removeTmpVault(vaultPath);
  });

  it('bootstraps a default schema with person and event when none exists', async () => {
    vaultPath = await makeTmpVault();
    const schema = await readSchema(vaultPath);
    expect(schema.types.person.folder).toBe('People');
    expect(schema.types.event.folder).toBe('Events');
    const written = await fs.readFile(schemaFilePath(vaultPath), 'utf8');
    expect(written).toContain('People');
  });

  it('round-trips a written schema', async () => {
    vaultPath = await makeTmpVault();
    const schema = defaultSchema();
    schema.types.place = { folder: 'Places', structuredFields: [] };
    await writeSchema(vaultPath, schema);
    const reloaded = await readSchema(vaultPath);
    expect(reloaded.types.place).toEqual({ folder: 'Places', structuredFields: [] });
  });
});
