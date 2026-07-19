/**
 * YAML config loader.
 * Simple parser — no dependency needed for the subset we use.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Load config.yaml and return parsed object.
 * @param {string} configPath
 */
export async function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    return { output_dir: './output', since_hours: 24, model: 'ollama', channels: [], playlists: [], videos: [] };
  }

  const raw = await readFile(configPath, 'utf8');
  return parseSimpleYaml(raw);
}

/**
 * Minimal YAML parser for our flat config format.
 * Handles scalars and simple lists (lines starting with "  - ").
 */
function parseSimpleYaml(text) {
  const result = {};
  let currentKey = null;

  for (const line of text.split('\n')) {
    // Skip comments and empty lines
    if (/^\s*#/.test(line) || !line.trim()) continue;

    // List item
    const listMatch = line.match(/^\s+-\s+(.+)/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      const val = listMatch[1].trim();
      // Skip commented-out list items
      if (!val.startsWith('#')) {
        result[currentKey].push(val);
      }
      continue;
    }

    // Key: value
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val) {
        // Parse numbers and booleans
        if (/^\d+$/.test(val)) result[currentKey] = parseInt(val, 10);
        else if (val === 'true') result[currentKey] = true;
        else if (val === 'false') result[currentKey] = false;
        else result[currentKey] = val;
      } else {
        result[currentKey] = [];
      }
    }
  }

  return result;
}
