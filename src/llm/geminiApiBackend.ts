import { GoogleGenAI } from '@google/genai';
import type { Content, FunctionCall, Part } from '@google/genai';
import type { Config } from '../config.js';
import { parseTimeoutToMs } from '../agy/runHeadless.js';
import { TOOL_DECLARATIONS } from './toolDeclarations.js';
import { z } from 'zod';
import * as handlers from '../mcp/handlers.js';
import {
  addAliasShape,
  createEntityShape,
  getSchemaShape,
  listEntitiesShape,
  proposeSchemaChangeShape,
  readEntityShape,
  searchEntitiesShape,
  writeFactShape,
} from '../mcp/toolSchemas.js';
import type { LlmBackend } from './types.js';

/** Internal safety valve against a runaway tool-calling loop — not configurable. */
const MAX_TURNS = 8;

type ToolHandler = (vaultPath: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Binds a handler to the SAME zod shape the MCP server validates with
 * (src/mcp/toolSchemas.ts). The z.object is built once here at module load;
 * each call parses the model's raw args before the handler runs, so a
 * malformed/incomplete call throws a ZodError instead of reaching the vault
 * with `undefined` fields.
 */
function validated<S extends z.ZodRawShape>(
  shape: S,
  run: (vaultPath: string, args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
): ToolHandler {
  const schema = z.object(shape);
  return (vaultPath, rawArgs) => run(vaultPath, schema.parse(rawArgs));
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_schema: validated(getSchemaShape, (vaultPath) => handlers.getSchema(vaultPath)),
  list_entities: validated(listEntitiesShape, (vaultPath, { type }) => handlers.listEntities(vaultPath, type)),
  search_entities: validated(searchEntitiesShape, (vaultPath, { query }) =>
    handlers.searchEntitiesHandler(vaultPath, query),
  ),
  read_entity: validated(readEntityShape, (vaultPath, { type, name }) =>
    handlers.readEntityHandler(vaultPath, type, name),
  ),
  write_fact: validated(writeFactShape, (vaultPath, { type, name, key, value, relatedEntities }) =>
    handlers.writeFact(vaultPath, type, name, key, value, relatedEntities),
  ),
  create_entity: validated(createEntityShape, (vaultPath, { type, name, fields }) =>
    handlers.createEntity(vaultPath, type, name, fields),
  ),
  add_alias: validated(addAliasShape, (vaultPath, { type, name, alias }) =>
    handlers.addAlias(vaultPath, type, name, alias),
  ),
  propose_schema_change: validated(proposeSchemaChangeShape, (vaultPath, { description, change }) =>
    handlers.proposeSchemaChange(vaultPath, description, change),
  ),
};

function toolErrorMessage(toolName: string | undefined, err: unknown): string {
  if (err instanceof z.ZodError) {
    const issues = err.issues.map((issue) => `${issue.path.join('.') || '(args)'}: ${issue.message}`).join('; ');
    return `Invalid arguments for ${toolName}: ${issues}`;
  }
  return (err as Error).message;
}

export function createGeminiApiBackend(config: Config): LlmBackend {
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const timeoutMs = parseTimeoutToMs(config.geminiApiTimeout);

  return async (prompt: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        console.log(`[gemini-api] turn ${turn + 1}/${MAX_TURNS}: calling generateContent...`);
        const result = await ai.models.generateContent({
          model: config.geminiApiModel,
          contents,
          config: {
            abortSignal: controller.signal,
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          },
        });

        const functionCalls: FunctionCall[] = result.functionCalls ?? [];
        if (functionCalls.length === 0) {
          console.log(`[gemini-api] turn ${turn + 1}: no tool calls, final response`);
          return { response: result.text ?? '', raw: result };
        }
        console.log(`[gemini-api] turn ${turn + 1}: ${functionCalls.length} tool call(s) requested`);

        // Echo the model's own turn back VERBATIM: it carries thoughtSignature
        // on its parts (which Gemini 3.x-generation models validate on the next
        // request — a hand-rebuilt turn without it is rejected with a 400), any
        // text parts emitted alongside the calls, and each call's id. Only if
        // the SDK genuinely gave us no candidate content do we fall back to
        // rebuilding the turn from functionCalls.
        contents.push(
          result.candidates?.[0]?.content ?? {
            role: 'model',
            parts: functionCalls.map((call) => ({ functionCall: call })),
          },
        );

        const responseParts: Part[] = [];
        for (const call of functionCalls) {
          console.log(`[gemini-api] tool call: ${call.name}(${JSON.stringify(call.args)})`);
          const handler = call.name ? TOOL_HANDLERS[call.name] : undefined;
          let output: unknown;
          if (!handler) {
            output = { error: `Unknown tool: ${call.name}` };
            console.error(`[gemini-api] tool error: ${call.name} -> unknown tool`);
          } else {
            try {
              output = await handler(config.vaultPath, call.args ?? {});
              console.log(`[gemini-api] tool result: ${call.name} ->`, JSON.stringify(output));
            } catch (err) {
              // Covers both argument-validation failures (ZodError) and the
              // handler's own errors: fed back to the model, never thrown.
              const message = toolErrorMessage(call.name, err);
              output = { error: message };
              console.error(`[gemini-api] tool error: ${call.name} -> ${message}`);
            }
          }
          // Echo the call's id (when the API populated one) so the response is
          // matched to the right call, per FunctionResponse.id in the SDK.
          responseParts.push({
            functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { result: output } },
          });
        }
        // Per the installed SDK's Content.role doc ("Must be either 'user' or
        // 'model'"), a function-response turn is sent with role 'user' — NOT
        // 'function' (which is not a documented value for this field).
        contents.push({ role: 'user', parts: responseParts });
      }

      throw new Error(`gemini-api backend exceeded ${MAX_TURNS} tool-calling turns without a final response`);
    } finally {
      clearTimeout(timer);
    }
  };
}
