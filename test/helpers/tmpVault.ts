import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function makeTmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'memory-keeper-'));
}

export async function removeTmpVault(vaultPath: string): Promise<void> {
  await fs.rm(vaultPath, { recursive: true, force: true });
}
