import type { Config } from '../config.js';
import { runHeadless } from '../agy/runHeadless.js';
import type { LlmBackend } from './types.js';

export function createAgyBackend(config: Config): LlmBackend {
  return (prompt: string) =>
    runHeadless(prompt, {
      agyBin: config.agyBin,
      timeout: config.agyTimeout,
      cwd: config.agyCwd,
      model: config.agyModel,
    });
}
