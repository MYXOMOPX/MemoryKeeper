import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../src/config.js';

const runHeadlessMock = vi.fn();
vi.mock('../../src/agy/runHeadless.js', () => ({ runHeadless: (...args: unknown[]) => runHeadlessMock(...args) }));

const { createAgyBackend } = await import('../../src/llm/agyBackend.js');

describe('createAgyBackend', () => {
  beforeEach(() => {
    runHeadlessMock.mockReset();
  });

  it('forwards agy-specific config fields to runHeadless and returns its result', async () => {
    runHeadlessMock.mockResolvedValue({ response: 'ok', status: 'SUCCESS', raw: { status: 'SUCCESS' } });

    const config = {
      agyBin: 'agy',
      agyTimeout: '2m',
      agyCwd: '/scratch',
      agyModel: 'gemini-3.8-flash-low',
    } as Config;

    const backend = createAgyBackend(config);
    const result = await backend('привет');

    expect(runHeadlessMock).toHaveBeenCalledWith('привет', {
      agyBin: 'agy',
      timeout: '2m',
      cwd: '/scratch',
      model: 'gemini-3.8-flash-low',
    });
    expect(result).toEqual({ response: 'ok', status: 'SUCCESS', raw: { status: 'SUCCESS' } });
  });
});
