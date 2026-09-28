import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { VaultSchema } from './types.js';

const SCHEMA_FILENAME = '_schema.yaml';

export function defaultSchema(): VaultSchema {
  return {
    types: {
      person: { folder: 'People', structuredFields: [] },
      event: { folder: 'Events', structuredFields: ['date', 'location'] },
    },
  };
}

export function schemaFilePath(vaultPath: string): string {
  return path.join(vaultPath, SCHEMA_FILENAME);
}

export async function readSchema(vaultPath: string): Promise<VaultSchema> {
  const filePath = schemaFilePath(vaultPath);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return YAML.parse(raw) as VaultSchema;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const schema = defaultSchema();
      await writeSchema(vaultPath, schema);
      return schema;
    }
    throw err;
  }
}

export async function writeSchema(vaultPath: string, schema: VaultSchema): Promise<void> {
  await fs.mkdir(vaultPath, { recursive: true });
  await fs.writeFile(schemaFilePath(vaultPath), YAML.stringify(schema), 'utf8');
}
