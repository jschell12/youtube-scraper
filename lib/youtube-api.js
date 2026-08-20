/**
 * Video discovery via the YouTube Data API v3.
 *
 * Used when YOUTUBE_API_KEY is set: listing a channel's recent uploads costs
 * 1-2 quota units per page instead of a slow yt-dlp metadata crawl, and lets
 * the scraper skip ledger-seen videos before yt-dlp is invoked at all.
 * yt-dlp remains the transcript fetcher; this module only discovers ids.
 *
 * The channel-level helpers at the bottom back `cli.js discover` (lib/discover.js),
 * which finds NEW channels rather than new videos on known ones.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export function apiKey() {
  return process.env.YOUTUBE_API_KEY || '';
}

async function apiGet(path, params) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey());
  const res = await fetch(url);
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      reason = body?.error?.message || reason;
    } catch {}
    throw new Error(`youtube api ${path}: ${reason}`);
  }
  return res.json();
}

/**
 * Parse a YouTube URL into a discovery target.
 * Returns { kind: 'channelId'|'handle'|'user'|'playlist', value } or null
 * when the URL is not API-discoverable (single videos, /c/ vanity URLs).
 */
export function parseSourceUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;

  const list = u.searchParams.get('list');
  if (u.pathname === '/playlist' && list) return { kind: 'playlist', value: list };

  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0].startsWith('@')) return { kind: 'handle', value: parts[0] };
  if (parts[0] === 'channel' && parts[1]) return { kind: 'channelId', value: parts[1] };
  if (parts[0] === 'user' && parts[1]) return { kind: 'user', value: parts[1] };
  return null;
}

/**
 * Resolve a discovery target to an uploads playlist id.
 */
async function uploadsPlaylistId(target) {
  if (target.kind === 'playlist') return target.value;

  const params = { part: 'contentDetails', maxResults: '1' };
  if (target.kind === 'channelId') params.id = target.value;
  else if (target.kind === 'handle') params.forHandle = target.value;
  else if (target.kind === 'user') params.forUsername = target.value;

  const data = await apiGet('channels', params);
  const uploads = data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`channel not found for ${target.kind}=${target.value}`);
  return uploads;
}

/**
 * List recent videos for a channel/playlist URL via the Data API.
 * Returns [{ id, url, title, publishedAt }] newest-first, bounded by
 * sinceHours and limit. Throws when the URL is not API-discoverable or the
 * API call fails — callers fall back to yt-dlp listing.
 */
export async function discoverVideos(url, { sinceHours = 24, limit = 50 } = {}) {
  const target = parseSourceUrl(url);
  if (!target) throw new Error(`not api-discoverable: ${url}`);

  const playlistId = await uploadsPlaylistId(target);
  const cutoff = sinceHours ? Date.now() - sinceHours * 3600_000 : 0;

  const videos = [];
  let pageToken = '';
  // Uploads playlists are newest-first; stop at the first page whose items
  // are all older than the cutoff.
  for (let page = 0; page < 10 && videos.length < limit; page++) {
    const params = { part: 'snippet,contentDetails', playlistId, maxResults: '50' };
    if (pageToken) params.pageToken = pageToken;
    const data = await apiGet('playlistItems', params);

    let sawOlder = false;
    for (const item of data.items || []) {
      const id = item.contentDetails?.videoId;
      const publishedAt = item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt;
      if (!id || !publishedAt) continue;
      if (cutoff && new Date(publishedAt).getTime() < cutoff) {
        sawOlder = true;
        continue;
      }
      videos.push({
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: item.snippet?.title || id,
        publishedAt,
      });
      if (videos.length >= limit) break;
    }

    pageToken = data.nextPageToken || '';
    if (!pageToken || sawOlder) break;
  }

  return videos;
}

// ── Channel discovery (lib/discover.js) ─────────────────────────────────
//
// search.list is the expensive call in the whole codebase: 100 quota units
// each against a 10,000/day free cap. Callers should keep query counts small
// and lean on the cheap calls (channels.list, playlistItems.list = 1 unit)
// for everything else.

/**
 * Search YouTube for channels matching a query.
 * Returns [{ id, title, description, thumbnail }] — snippet data only; call
 * channelDetails() for stats. Costs 100 quota units.
 */
export async function searchChannels(query, { limit = 10 } = {}) {
  const data = await apiGet('search', {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: String(Math.min(limit, 50)),
    relevanceLanguage: 'en',
    order: 'relevance',
  });
  return (data.items || [])
    .map(item => ({
      id: item.snippet?.channelId || item.id?.channelId,
      title: item.snippet?.channelTitle || item.snippet?.title || '',
      description: item.snippet?.description || '',
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
    }))
    .filter(c => /^UC[\w-]{22}$/.test(c.id || ''));
}

/**
 * Stats + metadata for up to 50 channel ids at a time.
 * Returns a Map keyed by channel id. Costs 1 quota unit per batch.
 */
export async function channelDetails(channelIds) {
  const out = new Map();
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const data = await apiGet('channels', {
      part: 'snippet,statistics,contentDetails',
      id: batch.join(','),
    });
    for (const ch of data.items || []) {
      out.set(ch.id, {
        id: ch.id,
        title: ch.snippet?.title || ch.id,
        description: ch.snippet?.description || '',
        // The handle ("@name"), so a candidate can be matched against @handle sources.
        handle: (ch.snippet?.customUrl || '').toLowerCase() || null,
        thumbnail: ch.snippet?.thumbnails?.medium?.url || ch.snippet?.thumbnails?.default?.url || null,
        subscribers: Number(ch.statistics?.subscriberCount) || null,
        videoCount: Number(ch.statistics?.videoCount) || null,
        uploadsPlaylist: ch.contentDetails?.relatedPlaylists?.uploads || null,
      });
    }
  }
  return out;
}

/**
 * Recent upload titles for a channel's uploads playlist — the evidence a judge
 * needs to tell an active, on-topic channel from a dormant or off-topic one.
 * Returns { titles, lastUpload }. Costs 1 quota unit.
 */
export async function recentUploads(uploadsPlaylistId, { limit = 10 } = {}) {
  const data = await apiGet('playlistItems', {
    part: 'snippet',
    playlistId: uploadsPlaylistId,
    maxResults: String(Math.min(limit, 50)),
  });
  const items = data.items || [];
  return {
    titles: items.map(i => i.snippet?.title).filter(Boolean),
    lastUpload: items[0]?.snippet?.publishedAt || null,
  };
}
