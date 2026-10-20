/**
 * `exclude_channels`: channel ids whose videos must never be fetched, written
 * or pushed, whatever source they arrive through (a channel source, a search
 * hit, a playlist entry, an explicit video URL).
 *
 * A malformed id throws rather than being ignored: a typo in a skip list would
 * otherwise admit the very channel it was meant to keep out, silently.
 */

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

/** The configured exclude list as a Set of channel ids. Missing or empty is an empty Set. */
export function excludedChannels(config = {}) {
  const raw = config.exclude_channels;
  if (raw == null || raw === '') return new Set();
  const list = Array.isArray(raw) ? raw : [raw];
  const out = new Set();
  for (const v of list) {
    const id = String(v).trim();
    if (!CHANNEL_ID_RE.test(id)) {
      throw new Error(`exclude_channels: "${id}" is not a channel id (expected UC followed by 22 characters)`);
    }
    out.add(id);
  }
  return out;
}

/** True when `channelId` is on the exclude list. An unknown (null) channel is not excluded. */
export function isExcludedChannel(channelId, exclude) {
  return Boolean(channelId) && Boolean(exclude?.has(channelId));
}

/** The channel id a /channel/UC... source URL names, else null (handles, playlists, videos). */
export function channelIdOfSource(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/channel\/(UC[\w-]{22})(\/|$)/);
  return m ? m[1] : null;
}

/** True when the source URL itself is an excluded channel. */
export function isExcludedSource(url, exclude) {
  return isExcludedChannel(channelIdOfSource(url), exclude);
}
