/**
 * Profile-based source configuration.
 *
 * Profiles live in `<dataDir>/profiles.json`:
 *   { "version": 1, "profiles": { "josh": { "channels": [...], "playlists": [...], "videos": [...] } } }
 *
 * The effective source list for a scrape is the union of the base
 * config.yaml lists and every profile's lists (deduped, order-preserving).
 */

import fs from 'node:fs';
import path from 'node:path';

export const SOURCE_KEYS = ['channels', 'playlists', 'videos'];

export const PROFILE_NAME_RE = /^[a-z0-9_-]{1,32}$/i;

const URL_PATTERNS = {
  channels: /^https:\/\/(www\.)?youtube\.com\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)\/?$/,
  playlists: /^https:\/\/(www\.)?youtube\.com\/playlist\?list=[\w-]+$/,
  videos: /^https:\/\/((www\.)?youtube\.com\/watch\?v=[\w-]{11}([&?].*)?|youtu\.be\/[\w-]{11})$/,
};

const MAX_LIST_LENGTH = 200;

function profilesPath(dataDir) {
  return path.join(dataDir, 'profiles.json');
}

/** Read profiles.json from the data dir. Returns an empty doc if missing/corrupt. */
export function readProfiles(dataDir) {
  try {
    const doc = JSON.parse(fs.readFileSync(profilesPath(dataDir), 'utf8'));
    if (doc && typeof doc.profiles === 'object' && doc.profiles !== null) {
      return { version: 1, profiles: doc.profiles };
    }
  } catch { /* missing or corrupt — treat as empty */ }
  return { version: 1, profiles: {} };
}

/**
 * Validate a profile object. Returns an array of error strings (empty = valid).
 */
export function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return ['profile must be an object'];
  }
  for (const key of Object.keys(profile)) {
    if (!SOURCE_KEYS.includes(key)) {
      errors.push(`unknown key "${key}" (allowed: ${SOURCE_KEYS.join(', ')})`);
      continue;
    }
    const list = profile[key];
    if (!Array.isArray(list)) {
      errors.push(`${key} must be an array`);
      continue;
    }
    if (list.length > MAX_LIST_LENGTH) {
      errors.push(`${key} exceeds ${MAX_LIST_LENGTH} entries`);
      continue;
    }
    for (const entry of list) {
      if (typeof entry !== 'string' || !URL_PATTERNS[key].test(entry.trim())) {
        errors.push(`${key}: invalid URL "${entry}"`);
      }
    }
  }
  return errors;
}

/**
 * Atomically upsert one profile into profiles.json.
 * Throws on validation failure.
 */
export function writeProfile(dataDir, name, profile) {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new Error(`invalid profile name "${name}"`);
  }
  const errors = validateProfile(profile);
  if (errors.length > 0) {
    const err = new Error(`invalid profile: ${errors.join('; ')}`);
    err.validationErrors = errors;
    throw err;
  }
  const doc = readProfiles(dataDir);
  const clean = {};
  for (const key of SOURCE_KEYS) {
    clean[key] = (profile[key] || []).map(s => s.trim());
  }
  doc.profiles[name] = clean;

  fs.mkdirSync(dataDir, { recursive: true });
  const target = profilesPath(dataDir);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, target);
  return doc;
}

/**
 * Union of base config lists and every profile's lists, deduped, order-preserving.
 * Returns { channels, playlists, videos }.
 */
export function mergeSources(baseConfig, profilesDoc) {
  const effective = {};
  for (const key of SOURCE_KEYS) {
    const seen = new Set();
    const merged = [];
    const lists = [
      baseConfig?.[key] || [],
      ...Object.values(profilesDoc?.profiles || {}).map(p => p?.[key] || []),
    ];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const entry = String(raw).trim();
        if (!entry || seen.has(entry)) continue;
        seen.add(entry);
        merged.push(entry);
      }
    }
    effective[key] = merged;
  }
  return effective;
}
