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

function callClaudeCLI(prompt, { model = 'haiku', timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` };
    delete env.ANTHROPIC_API_KEY;
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
      if (stdout) return resolve(stdout);
      if (code !== 0) return reject(new Error(`Claude CLI failed: ${stderr || `exit code ${code}`}`));
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
