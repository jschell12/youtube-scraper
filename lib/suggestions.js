/**
 * Channel suggestion store — the review queue for `cli.js discover`.
 *
 * Suggestions live in `<dataDir>/suggestions.json`, alongside seen.json and
 * profiles.json:
 *   { "version": 1, "channels": { "UC…": { …, status: "suggested" } } }
 *
 * A channel is only ever suggested once: discovery skips every id already in
 * the store, whatever its status, so a dismissed channel stays dismissed and
 * an approved one is not re-proposed. Approving writes the channel URL into a
 * profile (default "discovered"), which is what puts it into the next scrape —
 * see lib/profiles.js for how profile sources are merged into a run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readProfiles, writeProfile } from './profiles.js';

export const STATUSES = ['suggested', 'approved', 'dismissed'];
export const DEFAULT_PROFILE = 'discovered';

export const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

function storePath(dataDir) {
  return path.join(dataDir, 'suggestions.json');
}

export function channelUrl(channelId) {
  return `https://www.youtube.com/channel/${channelId}`;
}

/** Read suggestions.json. Returns an empty doc if missing or corrupt. */
export function readSuggestions(dataDir) {
  try {
    const doc = JSON.parse(fs.readFileSync(storePath(dataDir), 'utf8'));
    if (doc && typeof doc.channels === 'object' && doc.channels !== null) {
      return { version: 1, channels: doc.channels };
    }
  } catch { /* missing or corrupt — treat as empty */ }
  return { version: 1, channels: {} };
}

function writeStore(dataDir, doc) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = storePath(dataDir);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, target);
  return doc;
}

/**
 * Record a newly discovered channel. Returns true if it was stored, false if
 * that id was already known (any status) — reviewed channels are never revived.
 */
export function addSuggestion(dataDir, entry) {
  const id = String(entry?.id || '').trim();
  if (!CHANNEL_ID_RE.test(id)) throw new Error(`invalid channel id "${id}"`);

  const doc = readSuggestions(dataDir);
  if (doc.channels[id]) return false;

  doc.channels[id] = {
    id,
    url: channelUrl(id),
    title: entry.title || id,
    description: (entry.description || '').slice(0, 2000),
    thumbnail: entry.thumbnail || null,
    subscribers: entry.subscribers ?? null,
    videoCount: entry.videoCount ?? null,
    lastUpload: entry.lastUpload || null,
    topic: entry.topic || null,
    // Optional bucket a labelled topic filed this channel under (lib/discover.js).
    label: entry.label || null,
    rationale: entry.rationale || null,
    recentTitles: (entry.recentTitles || []).slice(0, 15),
    status: 'suggested',
    discoveredAt: new Date().toISOString(),
    reviewedAt: null,
  };
  writeStore(dataDir, doc);
  return true;
}

/** List suggestions, newest first. Filter by status and/or topic. */
export function listSuggestions(dataDir, { status, topic } = {}) {
  return Object.values(readSuggestions(dataDir).channels)
    .filter(c => (!status || c.status === status) && (!topic || c.topic === topic))
    .sort((a, b) => String(b.discoveredAt).localeCompare(String(a.discoveredAt)));
}

/**
 * Approve or dismiss a suggestion.
 *
 * Approving also appends the channel URL to `profile` (created if absent), so
 * the next scrape picks it up — that write is what makes approval mean
 * something. Returns the updated entry.
 */
export function reviewSuggestion(dataDir, channelId, status, { profile = DEFAULT_PROFILE } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}"`);
  const doc = readSuggestions(dataDir);
  const entry = doc.channels[channelId];
  if (!entry) throw new Error(`no suggestion for channel "${channelId}"`);

  if (status === 'approved') {
    const existing = readProfiles(dataDir).profiles[profile] || {};
    const channels = existing.channels || [];
    if (!channels.includes(entry.url)) {
      writeProfile(dataDir, profile, { ...existing, channels: [...channels, entry.url] });
    }
    entry.profile = profile;
  }

  entry.status = status;
  entry.reviewedAt = new Date().toISOString();
  writeStore(dataDir, doc);
  return entry;
}

/**
 * Everything channel discovery should not propose again: ids already in the
 * store, plus the channels already being scraped.
 *
 * Sources identify channels three ways, and each is matched at a different
 * point in the run: /channel/UC… URLs give an id outright (skipped at search
 * time); @handle URLs do not, so handles come back separately and are matched
 * against snippet.customUrl once enrichment has fetched it; titles catch a
 * channel re-listed under a new id (skipped at search time).
 */
export function knownChannels(dataDir, sources = []) {
  const stored = Object.values(readSuggestions(dataDir).channels);
  const ids = new Set(stored.map(c => c.id));
  const titles = new Set(stored.map(c => String(c.title || '').trim().toLowerCase()).filter(Boolean));
  const handles = new Set();
  for (const url of sources) {
    const id = String(url).match(/\/channel\/(UC[\w-]{22})/)?.[1];
    if (id) ids.add(id);
    const handle = String(url).match(/youtube\.com\/(@[\w.-]+)/)?.[1];
    if (handle) handles.add(handle.toLowerCase());
  }
  return { ids, handles, titles };
}
