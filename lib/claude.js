/**
 * LLM helper — uses Ollama (free, local) with Claude CLI fallback.
 */

import { spawn } from 'node:child_process';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://10.0.0.2:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral-small:24b';

async function callOllama(prompt, { model = OLLAMA_MODEL, timeout = 300_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timer);
  }
}

function callClaudeCLI(prompt, { model = 'haiku', timeout = 120_000, useApiKey = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` };
    // Prefer Max subscription auth (free) over per-token API billing — but on
    // machines with no claude.ai login (e.g. the mac-mini LaunchAgents), retry
    // with the API key below.
    if (!useApiKey) delete env.ANTHROPIC_API_KEY;
    const child = spawn('claude', ['-p', prompt, '--model', model, '--dangerously-skip-permissions'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => { chunks.push(d); });
    child.stderr.on('data', (d) => errChunks.push(d));

    const timer = setTimeout(() => { child.kill('SIGTERM'); }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString().trim();
      const stderr = Buffer.concat(errChunks).toString().trim();
      // The CLI prints auth errors ("Not logged in · Please run /login") to
      // stdout — never accept output from a failed run as an LLM response.
      if (code !== 0) {
        const notLoggedIn = /not logged in/i.test(stdout) || /not logged in/i.test(stderr);
        if (notLoggedIn && !useApiKey && process.env.ANTHROPIC_API_KEY) {
          return resolve(callClaudeCLI(prompt, { model, timeout, useApiKey: true }));
        }
        return reject(new Error(`Claude CLI failed: ${stdout || stderr || `exit code ${code}`}`));
      }
      resolve(stdout);
    });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Claude CLI failed: ${e.message}`)); });
  });
}

/**
 * Call LLM — Ollama first, Claude CLI fallback.
 * @param {string} prompt
 * @param {object} opts
 * @param {string} opts.model - 'ollama' (default), 'haiku', 'sonnet', 'opus'
 * @param {number} opts.timeout - ms (default 300s)
 * @returns {string} LLM response text
 */
export async function callClaude(prompt, { model = 'ollama', timeout = 300_000 } = {}) {
  if (model === 'haiku' || model === 'sonnet' || model === 'opus') {
    return callClaudeCLI(prompt, { model, timeout });
  }

  try {
    return await callOllama(prompt, { timeout });
  } catch (err) {
    process.stderr.write(`ollama failed (${err.message}), trying claude CLI...\n`);
    return callClaudeCLI(prompt, { model: 'haiku', timeout });
  }
}
