#!/usr/bin/env node
/**
 * One-time OAuth consent flow for a profile's YouTube subscriptions.
 *
 * Usage:
 *   YOUTUBE_OAUTH_CLIENT_ID=... YOUTUBE_OAUTH_CLIENT_SECRET=... \
 *     node scripts/youtube-auth.mjs <profile> [dataDir]
 *
 * (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET work as fallbacks — same Google
 * Cloud project. The project must have the YouTube Data API v3 enabled.)
 *
 * Writes <dataDir>/tokens/<profile>.json. Run locally with a browser,
 * then copy the token file to the scraper host's data dir.
 */

import http from 'node:http';
import { URL, URLSearchParams } from 'node:url';
import { getClientCredentials, writeToken } from '../lib/google-auth.js';
import { PROFILE_NAME_RE } from '../lib/profiles.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const REDIRECT_PORT = 8089;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const profile = process.argv[2];
const dataDir = process.argv[3] || process.env.YOUTUBE_OUTPUT_DIR || './output';

if (!profile || !PROFILE_NAME_RE.test(profile)) {
  console.error('Usage: node scripts/youtube-auth.mjs <profile> [dataDir]');
  process.exit(1);
}

const { clientId, clientSecret } = getClientCredentials();

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token even if previously granted
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400).end('Missing code parameter');
      return;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokens.error || tokenRes.status}`);

    writeToken(dataDir, profile, {
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: Date.now() + (tokens.expires_in || 3600) * 1000,
      scope: tokens.scope,
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Authenticated! You can close this tab.</h1>');
    server.close();
    console.log(`Token saved for profile "${profile}" at ${dataDir}/tokens/${profile}.json`);
  } catch (err) {
    res.writeHead(500).end('Auth failed');
    server.close();
    console.error(err.message);
    process.exitCode = 1;
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log(`\nOpen this URL in your browser to authorize:\n\n  ${authUrl}\n`);
  console.log(`Waiting for callback on ${REDIRECT_URI} ...\n`);
});
