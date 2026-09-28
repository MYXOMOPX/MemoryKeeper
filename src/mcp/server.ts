import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as handlers from './handlers.js';

const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) throw new Error('VAULT_PATH is required for the MCP server');

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }] };
}

const server = new McpServer({ name: 'memory-keeper-vault', version: '0.1.0' });

server.tool('get_schema', 'Return the vault entity-type schema', {}, async () => textResult(await handlers.getSchema(VAULT_PATH)));

server.tool('list_entities', 'List entities, optionally filtered by type', { type: z.string().optional() }, async ({ type }) =>
  textResult(await handlers.listEntities(VAULT_PATH, type)),
);

server.tool('search_entities', 'Find entities by name, alias, fact text or field value', { query: z.string() }, async ({ query }) =>
  textResult(await handlers.searchEntitiesHandler(VAULT_PATH, query)),
);

server.tool('read_entity', 'Read the full content of one entity', { type: z.string(), name: z.string() }, async ({ type, name }) =>
  textResult(await handlers.readEntityHandler(VAULT_PATH, type, name)),
);

server.tool(
  'write_fact',
  'Create or update a fact on an entity, creating the entity if it does not exist',
  {
    type: z.string(),
    name: z.string(),
    key: z.string(),
    value: z.string(),
    relatedEntities: z.array(z.object({ type: z.string(), name: z.string() })).optional(),
  },
  async ({ type, name, key, value, relatedEntities }) =>
    textResult(await handlers.writeFact(VAULT_PATH, type, name, key, value, relatedEntities)),
);

server.tool(
  'create_entity',
  'Explicitly create a new entity of a known type',
  { type: z.string(), name: z.string(), fields: z.record(z.string()).optional() },
  async ({ type, name, fields }) => textResult(await handlers.createEntity(VAULT_PATH, type, name, fields)),
);

server.tool(
  'propose_schema_change',
  'Record a proposed schema change; it is NOT applied until the user confirms it via /confirm_schema',
  {
    description: z.string(),
    change: z.union([
      z.object({ kind: z.literal('promote_field'), entityType: z.string(), factKey: z.string() }),
      z.object({
        kind: z.literal('new_type'),
        typeName: z.string(),
        folder: z.string(),
        structuredFields: z.array(z.string()),
      }),
    ]),
  },
  async ({ description, change }) => textResult(await handlers.proposeSchemaChange(VAULT_PATH, description, change)),
);

server.tool('apply_schema_change', 'Apply a previously confirmed schema-change proposal by id', { id: z.string() }, async ({ id }) =>
  textResult(await handlers.applySchemaChangeHandler(VAULT_PATH, id)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
