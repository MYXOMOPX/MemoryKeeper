import { spawn } from 'node:child_process';

export interface AgyResult {
  response: string;
  status: string;
  raw: unknown;
}

export interface RunHeadlessOptions {
  agyBin: string;
  timeout: string;
  cwd?: string;
  model?: string;
}

/** Extra time given to agy beyond its own --print-timeout before Node kills it. */
export const KILL_BUFFER_MS = 10_000;
/** Grace period between SIGTERM and SIGKILL for a hung agy process. */
export const SIGKILL_GRACE_MS = 5_000;

const UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

/** Parses durations like "30s", "2m", "1h", "500ms" into milliseconds. */
export function parseTimeoutToMs(timeout: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)\s*$/.exec(timeout);
  if (!match) throw new Error(`Invalid timeout "${timeout}": expected a number with ms/s/m/h suffix, e.g. "2m"`);
  return Math.round(Number(match[1]) * UNIT_MS[match[2]]);
}

export function runHeadless(prompt: string, options: RunHeadlessOptions): Promise<AgyResult> {
  return new Promise((resolve, reject) => {
    const killAfterMs = parseTimeoutToMs(options.timeout) + KILL_BUFFER_MS;
    const args = ['--mode', 'accept-edits', '--output-format', 'json', '--print-timeout', options.timeout];
    if (options.model) args.push('--model', options.model);
    args.push('-p', prompt);
    const child = spawn(options.agyBin, args, { cwd: options.cwd });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    // Node-side backstop: agy's own --print-timeout is not trusted alone. If the
    // child never closes, kill it and reject so the (sequential) bot keeps working.
    let sigkillTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      child.kill('SIGTERM');
      sigkillTimer = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS);
      sigkillTimer.unref?.();
      reject(new Error(`agy did not finish within ${options.timeout} (+${KILL_BUFFER_MS / 1000}s grace) and was killed`));
    }, killAfterMs);
    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
    };

    child.on('error', (err) => {
      clearTimers();
      reject(err);
    });
    child.on('close', (code) => {
      clearTimers();
      if (code !== 0) {
        reject(new Error(`agy exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { response: string; status: string };
        resolve({ response: parsed.response, status: parsed.status, raw: parsed });
      } catch (err) {
        reject(new Error(`Failed to parse agy output as JSON: ${(err as Error).message}\nstdout: ${stdout}`));
      }
    });
  });
}
