import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

const { runHeadless } = await import('../../src/agy/runHeadless.js');

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

describe('runHeadless', () => {
  beforeEach(() => {
    spawnMock.mockReset();
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
