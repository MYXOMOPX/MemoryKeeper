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
}

export function runHeadless(prompt: string, options: RunHeadlessOptions): Promise<AgyResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      options.agyBin,
      ['--mode', 'accept-edits', '--output-format', 'json', '--print-timeout', options.timeout, '-p', prompt],
      { cwd: options.cwd },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    child.on('error', reject);
    child.on('close', (code) => {
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
