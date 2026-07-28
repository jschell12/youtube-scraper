/**
 * Google OAuth for the YouTube Data API — no external dependencies.
 *
 * Client credentials from env (YouTube-specific first, gmail-scraper's
 * Google Cloud project as fallback since both use the same OAuth client):
 *   YOUTUBE_OAUTH_CLIENT_ID     || GMAIL_CLIENT_ID
 *   YOUTUBE_OAUTH_CLIENT_SECRET || GMAIL_CLIENT_SECRET
 *
 * Per-profile refresh tokens live at <dataDir>/tokens/<profile>.json
 * (rclone-excluded from the R2 sync; never leaves the machine).
 */

import fs from 'node:fs';
import path from 'node:path';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SUBSCRIPTIONS_URL = 'https://www.googleapis.com/youtube/v3/subscriptions';

export function getClientCredentials() {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const err = new Error('Missing YOUTUBE_OAUTH_CLIENT_ID/SECRET (or GMAIL_CLIENT_ID/SECRET fallback)');
    err.code = 'NO_CLIENT_CREDS';
    throw err;
  }
  return { clientId, clientSecret };
}

export function tokenPath(dataDir, profile) {
  return path.join(dataDir, 'tokens', `${profile}.json`);
}

export function readToken(dataDir, profile) {
  const p = tokenPath(dataDir, profile);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

export function writeToken(dataDir, profile, token) {
  const dir = path.join(dataDir, 'tokens');
  fs.mkdirSync(dir, { recursive: true });
  const p = tokenPath(dataDir, profile);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(token, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

/** Exchange a refresh token for a fresh access token. */
async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getClientCredentials();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`token refresh failed: ${body.error || res.status}`);
    err.code = body.error === 'invalid_grant' ? 'INVALID_GRANT' : 'REFRESH_FAILED';
    throw err;
  }
  return body.access_token;
}

/** Get a usable access token for a profile, refreshing if needed. */
export async function getAccessToken(dataDir, profile) {
  const token = readToken(dataDir, profile);
  if (!token) {
    const err = new Error(`no token for profile "${profile}" — run scripts/youtube-auth.mjs`);
    err.code = 'NO_TOKEN';
    throw err;
  }
  // Reuse cached access token when it has >60s left
  if (token.access_token && token.expiry_date && Date.now() < token.expiry_date - 60_000) {
    return token.access_token;
  }
  if (!token.refresh_token) {
    const err = new Error(`token for "${profile}" has no refresh_token — re-run consent`);
    err.code = 'NO_REFRESH_TOKEN';
    throw err;
  }
  const accessToken = await refreshAccessToken(token.refresh_token);
  writeToken(dataDir, profile, {
    ...token,
    access_token: accessToken,
    expiry_date: Date.now() + 55 * 60_000,
  });
  return accessToken;
}

/**
 * Fetch all channel subscriptions for a profile.
 * Returns [{ channelId, title, url }] sorted by title.
 */
export async function fetchSubscriptions(dataDir, profile) {
  const accessToken = await getAccessToken(dataDir, profile);
  const items = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      mine: 'true',
      maxResults: '50',
      order: 'alphabetical',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${SUBSCRIPTIONS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = body.error?.errors?.[0]?.reason || body.error?.message || res.status;
      const err = new Error(`subscriptions fetch failed: ${reason}`);
      err.code = 'SUBSCRIPTIONS_FAILED';
      throw err;
    }
    for (const item of body.items || []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (!channelId) continue;
      items.push({
        channelId,
        title: item.snippet.title || channelId,
        url: `https://www.youtube.com/channel/${channelId}`,
      });
    }
    pageToken = body.nextPageToken || null;
  } while (pageToken);

  return items;
}
