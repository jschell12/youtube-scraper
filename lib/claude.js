/**
 * Claude CLI wrapper — mirrors news-scraper's pattern.
 * Uses `claude -p` (Max subscription, no API cost).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Call Claude via CLI.
 * @param {string} prompt
 * @param {object} opts
 * @param {string} opts.model - 'haiku' | 'sonnet' | 'opus'
 * @param {number} opts.timeout - ms (default 120s)
 * @returns {string} Claude's response text
 */
export async function callClaude(prompt, { model = 'haiku', timeout = 120_000 } = {}) {
  try {
    const { stdout } = await execFileP('claude', [
      '-p', prompt,
      '--model', model,
      '--dangerously-skip-permissions',
    ], {
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    });
    return stdout.trim();
  } catch (err) {
    if (err.stdout) return err.stdout.trim();
    throw new Error(`Claude CLI failed: ${err.message}`);
  }
}
