export interface Config {
  telegramBotToken: string;
  allowedTelegramId: number;
  vaultPath: string;
  agyBin: string;
  agyTimeout: string;
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

  return {
    telegramBotToken,
    allowedTelegramId,
    vaultPath,
    agyBin: env.AGY_BIN ?? 'agy',
    agyTimeout: env.AGY_TIMEOUT ?? '2m',
  };
}
