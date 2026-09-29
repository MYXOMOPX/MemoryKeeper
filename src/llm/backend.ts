import type { Config } from '../config.js';
import type { LlmBackend } from './types.js';
import { createAgyBackend } from './agyBackend.js';
import { createGeminiApiBackend } from './geminiApiBackend.js';

export type { LlmBackend } from './types.js';

export function createLlmBackend(config: Config): LlmBackend {
  switch (config.llmBackend) {
    case 'agy':
      return createAgyBackend(config);
    case 'gemini-api':
      return createGeminiApiBackend(config);
  }
}
