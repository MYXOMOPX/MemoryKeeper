import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const validEnv = {
    TELEGRAM_BOT_TOKEN: 'token123',
    ALLOWED_TELEGRAM_ID: '42',
    VAULT_PATH: '/vault',
  };

  it('parses a valid environment', () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      telegramBotToken: 'token123',
      allowedTelegramId: 42,
      vaultPath: '/vault',
      agyBin: 'agy',
      agyTimeout: '2m',
    });
  });

  it('uses overrides for agyBin and agyTimeout when present', () => {
    const config = loadConfig({ ...validEnv, AGY_BIN: '/usr/local/bin/agy', AGY_TIMEOUT: '5m' });
    expect(config.agyBin).toBe('/usr/local/bin/agy');
    expect(config.agyTimeout).toBe('5m');
  });

  it('throws when TELEGRAM_BOT_TOKEN is missing', () => {
    const { TELEGRAM_BOT_TOKEN, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow('TELEGRAM_BOT_TOKEN is required');
  });

  it('throws when ALLOWED_TELEGRAM_ID is not an integer', () => {
    expect(() => loadConfig({ ...validEnv, ALLOWED_TELEGRAM_ID: 'abc' })).toThrow(
      'ALLOWED_TELEGRAM_ID must be an integer',
    );
  });
});
