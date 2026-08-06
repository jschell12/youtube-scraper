/**
 * Video discovery via the YouTube Data API v3.
 *
 * Used when YOUTUBE_API_KEY is set: listing a channel's recent uploads costs
 * 1-2 quota units per page instead of a slow yt-dlp metadata crawl, and lets
 * the scraper skip ledger-seen videos before yt-dlp is invoked at all.
 * yt-dlp remains the transcript fetcher; this module only discovers ids.
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
