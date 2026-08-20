/**
 * Channel discovery — find NEW channels worth scraping, not new videos on
 * channels you already follow.
 *
 * Per topic: ask the LLM for search queries → search.list → enrich candidates
 * with stats and recent upload titles → have the LLM judge each one against the
 * topic → store keepers as suggestions for review (lib/suggestions.js).
 *
 * The judge FAILS CLOSED. Everywhere else in this repo an LLM hiccup costs a
 * summary you can regenerate; here it would put junk in a review queue a human
 * has to clear, and a good channel missed today is simply found next run. So an
 * unusable verdict is a rejection.
 *
 * Topics come from config.yaml:
 *
 *   discover_topics:
 *     - tech: hands-on consumer tech reviews with specs, benchmarks, buying advice
 *     - cooking: recipe tutorials and technique explainers with real measurements
 *
 * Each entry is "<name>: <what you want from this topic>". The description is
 * the standard the judge holds candidates to, so write it the way you would
 * brief a person: say what earns a place and what does not.
 *
 * Keepers go to suggestions.json by default. A caller that keeps its own review
 * queue (trip-wizard files them in D1 and reviews them in its admin UI) passes
 * `known` — the ids/handles/titles it already has — and a `sink` to receive each
 * accepted channel, and the local store is not touched at all.
 */

import { apiKey, searchChannels, channelDetails, recentUploads } from './youtube-api.js';
import { callClaude } from './claude.js';
import { addSuggestion, knownChannels } from './suggestions.js';

const TOPIC_NAME_RE = /^[a-z0-9_-]{1,32}$/i;

/**
 * Parse `discover_topics` entries ("name: description") into { name, about }.
 * Malformed entries are dropped rather than guessed at.
 */
export function parseTopics(entries) {
  const topics = [];
  for (const raw of entries || []) {
    const line = String(raw).trim();
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const name = line.slice(0, idx).trim();
    const about = line.slice(idx + 1).trim();
    if (!TOPIC_NAME_RE.test(name) || !about) continue;
    topics.push({ name, about });
  }
  return topics;
}

/**
 * Ask the LLM for search queries for one topic, steered away from channels
 * already known. Falls back to the topic name when the LLM is unavailable —
 * a worse query is still a search; no query is no discovery.
 */
export async function generateQueries(topic, { count = 3, model = 'ollama', known = [] } = {}) {
  const avoid = known.slice(0, 40).join(', ') || '(none yet)';
  const prompt = `You help someone find new YouTube channels to follow.

Topic: ${topic.about}

Channels they already follow (avoid queries that would only re-find these): ${avoid}

Give ${count} diverse YouTube search queries (3-6 words each) likely to surface active
channels producing this kind of content. One query per line, no numbering, no other text.`;

  try {
    const text = await callClaude(prompt, { model, timeout: 120_000 });
    const queries = String(text)
      .trim()
      .split('\n')
      .map(l => l.replace(/^[-*\d.\s]+/, '').replace(/^["']|["']$/g, '').trim())
      .filter(l => l && l.length < 80);
    if (queries.length) return queries.slice(0, count);
  } catch { /* fall through to the default */ }
  return [`${topic.name.replace(/[_-]+/g, ' ')} channel`];
}

/**
 * Judge one candidate against its topic. FAILS CLOSED: anything other than a
 * well-formed ACCEPT is a rejection.
 * Returns { accept, rationale, reason }.
 */
export async function judgeChannel(candidate, topic, { model = 'ollama' } = {}) {
  // A topic may carry `labels` ([{ name, description }]) — buckets the caller
  // files accepted channels into, e.g. which destination a travel channel covers.
  // With labels the verdict is "ACCEPT: <label> | <reason>"; without, just a reason.
  const labels = topic.labels?.length ? topic.labels : null;
  const labelBlock = labels
    ? `\nFile accepted channels under exactly one of these labels:\n${
        labels.map(l => `- ${l.name}${l.description ? `: ${l.description}` : ''}`).join('\n')}\n`
    : '';

  const prompt = `You vet YouTube channels for someone who wants to follow this topic:

${topic.about}

ACCEPT only if the channel's recent output actually matches that description and is
substantive. REJECT channels that are dormant (no upload in ~6 months), not in English,
mostly reaction/vlog/ambience filler, or that exist mainly to sell the creator's own
course or merchandise.
${labelBlock}
Channel: ${candidate.title}
Subscribers: ${candidate.subscribers ?? 'unknown'} · Videos: ${candidate.videoCount ?? 'unknown'} · Last upload: ${candidate.lastUpload || 'unknown'}
Description: ${(candidate.description || '').slice(0, 500)}
Recent video titles:
${(candidate.recentTitles || []).map(t => `- ${t}`).join('\n') || '(none found)'}

Respond with a single line, exactly one of:
${labels ? 'ACCEPT: <label> | <one sentence on what this channel would add>' : 'ACCEPT: <one sentence on what this channel would add>'}
REJECT: <short reason>`;

  let text;
  try {
    text = await callClaude(prompt, { model, timeout: 120_000 });
  } catch (err) {
    return { accept: false, reason: `judge unavailable (${err.message})` };
  }
  const first = String(text || '').trim().split('\n')[0].trim();

  if (/^ACCEPT/i.test(first)) {
    const body = first.replace(/^ACCEPT:?\s*/i, '').trim();
    if (!labels) return { accept: true, rationale: body || 'no rationale given' };
    // "wdw | reason". An unrecognized label falls back to the topic's default
    // rather than rejecting — the human reviewing it can re-file either way.
    const [rawLabel, ...rest] = body.split('|');
    const name = rawLabel.trim().toLowerCase();
    const match = labels.find(l => l.name.toLowerCase() === name);
    return {
      accept: true,
      label: match?.name || topic.defaultLabel || labels[0].name,
      rationale: rest.join('|').trim() || body || 'no rationale given',
    };
  }
  if (/^REJECT/i.test(first)) {
    return { accept: false, reason: first.replace(/^REJECT:?\s*/i, '').trim() || 'no reason given' };
  }
  return { accept: false, reason: `unexpected verdict "${first.slice(0, 60)}"` };
}

/**
 * Run discovery across topics.
 *
 * @param {object} opts
 * @param {string} opts.dataDir        Where suggestions.json lives (the output dir)
 * @param {Array}  opts.topics         [{ name, about }]
 * @param {Array}  opts.sources        Channel URLs already being scraped (skipped)
 * @param {string} opts.model          LLM for query generation + judging
 * @param {number} opts.queriesPerTopic
 * @param {number} opts.resultsPerQuery
 * @param {number} opts.minSubscribers Skip smaller channels before judging (0 = off)
 * @param {boolean} opts.dryRun        Judge but do not store
 * @param {object} opts.known          { ids, handles, titles } Sets to skip; defaults to
 *                                     suggestions.json + `sources`. Pass this when your
 *                                     review queue lives somewhere else.
 * @param {function} opts.sink         async ({ channel, topic, verdict }) => boolean stored.
 *                                     Defaults to writing suggestions.json.
 * @param {function} opts.log
 * @param {object} opts.api            Injectable YouTube calls (tests)
 * @returns {Promise<{ suggested, rejected, evaluated, searched }>}
 */
export async function discover({
  dataDir,
  topics,
  sources = [],
  model = 'ollama',
  queriesPerTopic = 3,
  resultsPerQuery = 10,
  minSubscribers = 0,
  dryRun = false,
  known,
  sink,
  log = console.log,
  api = { searchChannels, channelDetails, recentUploads },
} = {}) {
  if (!topics?.length) throw new Error('no discover topics configured — add discover_topics to config.yaml');
  if (!apiKey()) throw new Error('YOUTUBE_API_KEY is required for channel discovery (Data API v3)');

  known = normalizeKnown(known) || knownChannels(dataDir, sources);
  const store = sink || (({ channel, topic, verdict }) => addSuggestion(dataDir, {
    id: channel.id,
    title: channel.title,
    description: channel.description,
    thumbnail: channel.thumbnail,
    subscribers: channel.subscribers,
    videoCount: channel.videoCount,
    lastUpload: channel.lastUpload,
    topic: topic.name,
    label: verdict.label,
    rationale: verdict.rationale,
    recentTitles: channel.recentTitles,
  }));
  log(`Known: ${known.ids.size} channel(s) already suggested or followed`);

  // ── search: topic → queries → candidates ──
  const candidates = new Map(); // id → { …snippet, topic }
  let searched = 0;
  for (const topic of topics) {
    const queries = await generateQueries(topic, {
      count: queriesPerTopic,
      model,
      known: sources.map(s => String(s)),
    });
    log(`\n▶ ${topic.name}: ${queries.map(q => `"${q}"`).join(', ')}`);
    for (const q of queries) {
      let found;
      try {
        found = await api.searchChannels(q, { limit: resultsPerQuery });
        searched++;
      } catch (err) {
        log(`  ✗ search failed for "${q}": ${err.message}`);
        continue;
      }
      for (const c of found) {
        if (known.ids.has(c.id) || candidates.has(c.id)) continue;
        // Same channel re-listed under a new id, or a source we only know by name.
        if (known.titles.has(String(c.title || '').trim().toLowerCase())) continue;
        candidates.set(c.id, { ...c, topic });
      }
    }
  }

  if (!candidates.size) {
    log('\nNo new candidate channels found.');
    return { suggested: 0, rejected: 0, evaluated: 0, searched };
  }
  log(`\n${candidates.size} new candidate channel(s) to evaluate`);

  // ── enrich: stats, handle, recent uploads ──
  const details = await api.channelDetails([...candidates.keys()]);
  for (const [id, c] of candidates) {
    const d = details.get(id);
    if (!d) {
      candidates.delete(id); // channel vanished between the search and this call
      continue;
    }
    Object.assign(c, {
      title: d.title || c.title,
      description: d.description || c.description,
      thumbnail: d.thumbnail || c.thumbnail,
      subscribers: d.subscribers,
      videoCount: d.videoCount,
      handle: d.handle,
      uploadsPlaylist: d.uploadsPlaylist,
    });
    // An @handle source and a /channel/UC… source are the same channel; the
    // handle only becomes comparable now that channels.list has returned it.
    if (c.handle && known.handles.has(c.handle)) candidates.delete(id);
  }

  for (const c of candidates.values()) {
    if (!c.uploadsPlaylist) continue;
    try {
      const { titles, lastUpload } = await api.recentUploads(c.uploadsPlaylist, { limit: 10 });
      c.recentTitles = titles;
      c.lastUpload = lastUpload;
    } catch {
      c.recentTitles = [];
    }
  }

  // ── judge and record ──
  let suggested = 0;
  let rejected = 0;
  let evaluated = 0;
  for (const c of candidates.values()) {
    if (minSubscribers && (c.subscribers ?? 0) < minSubscribers) {
      rejected++;
      log(`  ✗ ${c.title} — under ${minSubscribers} subscribers`);
      continue;
    }
    evaluated++;
    const verdict = await judgeChannel(c, c.topic, { model });
    if (!verdict.accept) {
      rejected++;
      log(`  ✗ ${c.title} — ${verdict.reason}`);
      continue;
    }
    const where = verdict.label ? `${c.topic.name} → ${verdict.label}` : c.topic.name;
    if (dryRun) {
      suggested++;
      log(`  ✓ ${c.title} (${where}) — ${verdict.rationale}  [dry run, not stored]`);
      continue;
    }
    let stored;
    try {
      stored = await store({ channel: c, topic: c.topic, verdict });
    } catch (err) {
      log(`  ✗ ${c.title} — could not store: ${err.message}`);
      continue;
    }
    if (stored) {
      suggested++;
      log(`  ✓ ${c.title} (${where}) — ${verdict.rationale}`);
    }
  }

  return { suggested, rejected, evaluated, searched };
}

// A caller's known-channel sets, tolerant of missing fields and plain arrays.
function normalizeKnown(known) {
  if (!known) return null;
  const set = (v) => (v instanceof Set ? v : new Set(v || []));
  return { ids: set(known.ids), handles: set(known.handles), titles: set(known.titles) };
}
