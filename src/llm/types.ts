export type LlmBackend = (prompt: string) => Promise<{ response: string; raw: unknown }>;
