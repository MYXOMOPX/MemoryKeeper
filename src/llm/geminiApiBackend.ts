import { GoogleGenAI } from '@google/genai';
import type { Content, FunctionCall, Part } from '@google/genai';
import type { Config } from '../config.js';
import { parseTimeoutToMs } from '../agy/runHeadless.js';
import { TOOL_DECLARATIONS } from './toolDeclarations.js';
import * as handlers from '../mcp/handlers.js';
import type { LlmBackend } from './types.js';

/** Internal safety valve against a runaway tool-calling loop — not configurable. */
const MAX_TURNS = 8;

type ToolHandler = (vaultPath: string, args: Record<string, unknown>) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_schema: (vaultPath) => handlers.getSchema(vaultPath),
  list_entities: (vaultPath, args) => handlers.listEntities(vaultPath, args.type as string | undefined),
  search_entities: (vaultPath, args) => handlers.searchEntitiesHandler(vaultPath, args.query as string),
  read_entity: (vaultPath, args) => handlers.readEntityHandler(vaultPath, args.type as string, args.name as string),
  write_fact: (vaultPath, args) =>
    handlers.writeFact(
      vaultPath,
      args.type as string,
      args.name as string,
      args.key as string,
      args.value as string,
      args.relatedEntities as { type: string; name: string }[] | undefined,
    ),
  create_entity: (vaultPath, args) =>
    handlers.createEntity(
      vaultPath,
      args.type as string,
      args.name as string,
      args.fields as Record<string, string> | undefined,
    ),
  add_alias: (vaultPath, args) =>
    handlers.addAlias(vaultPath, args.type as string, args.name as string, args.alias as string),
  propose_schema_change: (vaultPath, args) =>
    handlers.proposeSchemaChange(
      vaultPath,
      args.description as string,
      args.change as Parameters<typeof handlers.proposeSchemaChange>[2],
    ),
};

export function createGeminiApiBackend(config: Config): LlmBackend {
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const timeoutMs = parseTimeoutToMs(config.geminiApiTimeout);

  return async (prompt: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
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
          return { response: result.text ?? '', raw: result };
        }

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
          const handler = call.name ? TOOL_HANDLERS[call.name] : undefined;
          let output: unknown;
          if (!handler) {
            output = { error: `Unknown tool: ${call.name}` };
          } else {
            try {
              output = await handler(config.vaultPath, call.args ?? {});
            } catch (err) {
              output = { error: (err as Error).message };
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
