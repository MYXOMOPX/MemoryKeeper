import os from 'node:os';
import path from 'node:path';
import { parseTimeoutToMs } from './agy/runHeadless.js';

export interface Config {
  telegramBotToken: string;
  allowedTelegramId: number;
  vaultPath: string;
  agyBin: string;
  agyTimeout: string;
  agyCwd: string;
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
  };
}
