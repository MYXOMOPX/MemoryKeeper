import os from 'node:os';
import path from 'node:path';
import { parseTimeoutToMs } from './agy/runHeadless.js';

export type LlmBackendKind = 'agy' | 'gemini-api';

export interface Config {
  telegramBotToken: string;
  allowedTelegramId: number;
  vaultPath: string;
  agyBin: string;
  agyTimeout: string;
  agyCwd: string;
  agyModel: string;
  llmBackend: LlmBackendKind;
  geminiApiKey?: string;
  geminiApiModel: string;
  geminiApiTimeout: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
  const allowedTelegramIdRaw = env.ALLOWED_TELEGRAM_ID;
  const vaultPath = env.VAULT_PATH;

  if (!telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (!allowedTelegramIdRaw) throw new Error('ALLOWED_TELEGRAM_ID is required');
  if (!vaultPath) throw new Error('VAULT_PATH is required');

  const allowedTelegramId = Number(allowedTelegramIdRaw);
  if (!Number.isInteger(allowedTelegramId)) {
    throw new Error(`ALLOWED_TELEGRAM_ID must be an integer, got "${allowedTelegramIdRaw}"`);
  }

  const agyTimeout = env.AGY_TIMEOUT ?? '2m';
  // Fail fast at startup rather than on every message: runHeadless needs to
  // parse this for its Node-side kill timer.
  parseTimeoutToMs(agyTimeout);

  const llmBackendRaw = env.LLM_BACKEND ?? 'agy';
  if (llmBackendRaw !== 'agy' && llmBackendRaw !== 'gemini-api') {
    throw new Error(`LLM_BACKEND must be "agy" or "gemini-api", got "${llmBackendRaw}"`);
  }
  const llmBackend: LlmBackendKind = llmBackendRaw;

  const geminiApiKey = env.GEMINI_API_KEY;
  if (llmBackend === 'gemini-api' && !geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required when LLM_BACKEND=gemini-api');
  }

  const geminiApiTimeout = env.GEMINI_API_TIMEOUT ?? '2m';
  parseTimeoutToMs(geminiApiTimeout);

  return {
    telegramBotToken,
    allowedTelegramId,
    vaultPath,
    agyBin: env.AGY_BIN ?? 'agy',
    agyTimeout,
    // agy is a general coding-agent CLI: run from the project's own directory
    // (or any directory with real files), it indexes that as "the project"
    // before doing anything else, ballooning tokens and latency for no
    // reason. Give it an empty, dedicated scratch directory instead.
    agyCwd: env.AGY_CWD ?? path.join(os.tmpdir(), 'memory-keeper-agy-scratch'),
    // Passed as --model on every call so it only affects this bot's own agy
    // invocations, not the user's globally configured model for other
    // projects (settings.json's "model" is shared across all of them).
    agyModel: env.AGY_MODEL ?? 'gemini-3.8-flash-low',
    llmBackend,
    geminiApiKey,
    geminiApiModel: env.GEMINI_API_MODEL ?? 'gemini-2.5-flash-lite',
    geminiApiTimeout,
  };
}
