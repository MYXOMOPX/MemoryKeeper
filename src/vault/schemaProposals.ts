import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type SchemaChange =
  | { kind: 'promote_field'; entityType: string; factKey: string }
  | { kind: 'new_type'; typeName: string; folder: string; structuredFields: string[] };

export interface SchemaProposal {
  id: string;
  createdAt: string;
  description: string;
  change: SchemaChange;
}

function proposalsDir(vaultPath: string): string {
  return path.join(vaultPath, '.schema-proposals');
}

function proposalPath(vaultPath: string, id: string): string {
  return path.join(proposalsDir(vaultPath), `${id}.json`);
}

export async function saveProposal(
  vaultPath: string,
  description: string,
  change: SchemaChange,
): Promise<SchemaProposal> {
  const proposal: SchemaProposal = { id: randomUUID(), createdAt: new Date().toISOString(), description, change };
  await fs.mkdir(proposalsDir(vaultPath), { recursive: true });
  await fs.writeFile(proposalPath(vaultPath, proposal.id), JSON.stringify(proposal, null, 2), 'utf8');
  return proposal;
}

export async function getProposal(vaultPath: string, id: string): Promise<SchemaProposal | null> {
  try {
    const raw = await fs.readFile(proposalPath(vaultPath, id), 'utf8');
    return JSON.parse(raw) as SchemaProposal;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteProposal(vaultPath: string, id: string): Promise<void> {
  await fs.rm(proposalPath(vaultPath, id), { force: true });
}

export async function listProposals(vaultPath: string): Promise<SchemaProposal[]> {
  try {
    const dir = proposalsDir(vaultPath);
    const files = await fs.readdir(dir);
    const raws = await Promise.all(
      files.filter((f) => f.endsWith('.json')).map((f) => fs.readFile(path.join(dir, f), 'utf8')),
    );
    return raws.map((raw) => JSON.parse(raw) as SchemaProposal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
