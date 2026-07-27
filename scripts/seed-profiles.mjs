#!/usr/bin/env node

/**
 * One-time seed: copy base config.yaml source lists into a named profile.
 *
 * Usage:
 *   node scripts/seed-profiles.mjs --config config.yaml --data /Users/joshschell/data/youtube --profile josh
 *
 * No-op if the profile already has any sources.
 */

import { loadConfig } from '../lib/config.js';
import { readProfiles, writeProfile, SOURCE_KEYS } from '../lib/profiles.js';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const configPath = flag('--config', 'config.yaml');
const dataDir = flag('--data', process.env.YOUTUBE_OUTPUT_DIR || './output');
const profileName = flag('--profile', 'josh');

const base = await loadConfig(configPath);
const existing = readProfiles(dataDir).profiles[profileName];

if (existing && SOURCE_KEYS.some(k => (existing[k] || []).length > 0)) {
  console.log(`profile "${profileName}" already has sources — skipping seed`);
  process.exit(0);
}

const profile = Object.fromEntries(SOURCE_KEYS.map(k => [k, base[k] || []]));
writeProfile(dataDir, profileName, profile);
console.log(`seeded profile "${profileName}" in ${dataDir}/profiles.json:`);
console.log(JSON.stringify(profile, null, 2));
