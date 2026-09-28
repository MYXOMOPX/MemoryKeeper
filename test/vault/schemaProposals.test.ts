import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { saveProposal, getProposal, deleteProposal, listProposals } from '../../src/vault/schemaProposals.js';

describe('schema proposals', () => {
  let vaultPath: string;
  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('saves and retrieves a proposal by id', async () => {
    const saved = await saveProposal(vaultPath, 'Вынести чай в YAML', {
      kind: 'promote_field',
      entityType: 'person',
      factKey: 'Любимый чай',
    });
    const loaded = await getProposal(vaultPath, saved.id);
    expect(loaded).toEqual(saved);
  });

  it('returns null for an unknown id', async () => {
    expect(await getProposal(vaultPath, 'missing')).toBeNull();
  });

  it('lists all saved proposals', async () => {
    await saveProposal(vaultPath, 'A', { kind: 'new_type', typeName: 'place', folder: 'Places', structuredFields: [] });
    await saveProposal(vaultPath, 'B', { kind: 'promote_field', entityType: 'person', factKey: 'X' });
    const all = await listProposals(vaultPath);
    expect(all.map((p) => p.description).sort()).toEqual(['A', 'B']);
  });

  it('deletes a proposal', async () => {
    const saved = await saveProposal(vaultPath, 'A', { kind: 'promote_field', entityType: 'person', factKey: 'X' });
    await deleteProposal(vaultPath, saved.id);
    expect(await getProposal(vaultPath, saved.id)).toBeNull();
  });

  it('lists empty when no proposals directory exists yet', async () => {
    expect(await listProposals(vaultPath)).toEqual([]);
  });
});
