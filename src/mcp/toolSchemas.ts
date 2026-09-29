import { z } from 'zod';

/**
 * Zod argument shapes for the 8 vault tools — the single source of truth for
 * argument validation on BOTH paths: the MCP server (src/mcp/server.ts, via
 * server.tool) and the Gemini API backend's in-process tool loop
 * (src/llm/geminiApiBackend.ts). src/llm/toolDeclarations.ts mirrors these as
 * JSON Schema for the model; test/llm/geminiApiBackend.integration.test.ts
 * catches drift between the two.
 */

export const getSchemaShape = {};

export const listEntitiesShape = { type: z.string().optional() };

export const searchEntitiesShape = { query: z.string() };

export const readEntityShape = { type: z.string(), name: z.string() };

export const writeFactShape = {
  type: z.string(),
  name: z.string(),
  key: z.string(),
  value: z.string(),
  relatedEntities: z.array(z.object({ type: z.string(), name: z.string() })).optional(),
};

export const createEntityShape = { type: z.string(), name: z.string(), fields: z.record(z.string()).optional() };

export const addAliasShape = { type: z.string(), name: z.string(), alias: z.string() };

export const proposeSchemaChangeShape = {
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
};
