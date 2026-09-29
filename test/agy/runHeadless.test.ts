import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

const { runHeadless, parseTimeoutToMs, KILL_BUFFER_MS, SIGKILL_GRACE_MS } = await import('../../src/agy/runHeadless.js');

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
}

describe('parseTimeoutToMs', () => {
  it('parses s/m/h/ms suffixes', () => {
    expect(parseTimeoutToMs('30s')).toBe(30_000);
    expect(parseTimeoutToMs('2m')).toBe(120_000);
    expect(parseTimeoutToMs('1h')).toBe(3_600_000);
    expect(parseTimeoutToMs('500ms')).toBe(500);
  });

  it('throws on an unparseable duration', () => {
    expect(() => parseTimeoutToMs('2 minutes')).toThrow('Invalid timeout');
    expect(() => parseTimeoutToMs('120')).toThrow('Invalid timeout');
  });
});

describe('runHeadless', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('kills a hung child and rejects once the timeout plus buffer elapses', async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    const settled = vi.fn();
    promise.then(settled, settled);

    // Just before the deadline (2m + buffer): still waiting, nothing killed.
    await vi.advanceTimersByTimeAsync(120_000 + KILL_BUFFER_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();

    // Deadline reached: SIGTERM + rejection, even though the child never emits 'close'.
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(promise).rejects.toThrow('agy did not finish within 2m');

    // Still no 'close' after the grace period: escalate to SIGKILL.
    await vi.advanceTimersByTimeAsync(SIGKILL_GRACE_MS);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not kill the child after a normal completion', async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '30s' });
    child.stdout.emit('data', Buffer.from(JSON.stringify({ response: 'ok', status: 'SUCCESS' })));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ response: 'ok' });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects without spawning when the timeout string is invalid', async () => {
    await expect(runHeadless('привет', { agyBin: 'agy', timeout: 'soon' })).rejects.toThrow('Invalid timeout');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('resolves with the parsed response on success', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    child.stdout.emit('data', Buffer.from(JSON.stringify({ response: 'Записал факт', status: 'SUCCESS' })));
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ response: 'Записал факт', status: 'SUCCESS', raw: { response: 'Записал факт', status: 'SUCCESS' } });
    expect(spawnMock).toHaveBeenCalledWith(
      'agy',
      ['--mode', 'accept-edits', '--output-format', 'json', '--print-timeout', '2m', '-p', 'привет'],
      { cwd: undefined },
    );
  });

  it('includes --model when provided, omits it otherwise', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m', model: 'gemini-3.8-flash-low' });
    child.stdout.emit('data', Buffer.from(JSON.stringify({ response: 'ok', status: 'SUCCESS' })));
    child.emit('close', 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      'agy',
      [
        '--mode',
        'accept-edits',
        '--output-format',
        'json',
        '--print-timeout',
        '2m',
        '--model',
        'gemini-3.8-flash-low',
        '-p',
        'привет',
      ],
      { cwd: undefined },
    );
  });

  it('rejects with stderr content on non-zero exit', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    child.stderr.emit('data', Buffer.from('auth required'));
    child.emit('close', 1);

    await expect(promise).rejects.toThrow('agy exited with code 1: auth required');
  });

  it('rejects when stdout is not valid JSON', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    child.stdout.emit('data', Buffer.from('not json'));
    child.emit('close', 0);

    await expect(promise).rejects.toThrow('Failed to parse agy output as JSON');
  });

  it('rejects when the process itself fails to spawn', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runHeadless('привет', { agyBin: 'agy', timeout: '2m' });
    child.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow('ENOENT');
  });
});
