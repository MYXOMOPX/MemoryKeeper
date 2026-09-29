import os from 'node:os';
import path from 'node:path';
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
      agyCwd: path.join(os.tmpdir(), 'memory-keeper-agy-scratch'),
      agyModel: 'gemini-3.8-flash-low',
    });
  });

  it('uses overrides for agyBin, agyTimeout, agyCwd and agyModel when present', () => {
    const config = loadConfig({
      ...validEnv,
      AGY_BIN: '/usr/local/bin/agy',
      AGY_TIMEOUT: '5m',
      AGY_CWD: '/scratch/agy',
      AGY_MODEL: 'claude-sonnet-4-6',
    });
    expect(config.agyBin).toBe('/usr/local/bin/agy');
    expect(config.agyTimeout).toBe('5m');
    expect(config.agyCwd).toBe('/scratch/agy');
    expect(config.agyModel).toBe('claude-sonnet-4-6');
  });

  it('throws at startup when AGY_TIMEOUT is not a parseable duration', () => {
    expect(() => loadConfig({ ...validEnv, AGY_TIMEOUT: 'two minutes' })).toThrow('Invalid timeout');
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
