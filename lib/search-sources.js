/**
 * Search-query sources.
 *
 * A config can add YouTube searches alongside channels/playlists/videos.
 * They become yt-dlp `ytsearchN:<query>` source strings, which lib/scrape.js
 * lists flat (ids only), filters against the seen ledger, and only then fetches
 * captions for the unseen results, one video at a time.
 *
 * Config keys (all optional):
 *   search_queries:          fixed queries, run every scrape
 *   search_templates:        queries containing {team}, expanded per team
 *   search_teams:            the values {team} rotates through
 *   search_teams_per_run: N  how many teams each run takes (default 3)
 *   search_results: N        results per search (default 3)
 *
 * Rotation is by UTC day, so a once-a-day job walks the whole team list in
 * ceil(teams / perRun) days without keeping any state, and request volume per
 * run is (fixed queries + templates * perRun) searches.
 */

export const SEARCH_PREFIX_RE = /^ytsearch(\d*):(.+)$/;

export function isSearchSource(src) {
  return SEARCH_PREFIX_RE.test(src);
}

/** Teams for this run: a contiguous window that advances perRun each day. */
export function rotateTeams(teams, perRun, date = new Date()) {
  if (!teams.length || perRun <= 0) return [];
  const n = Math.min(perRun, teams.length);
  const day = Math.floor(date.getTime() / 86_400_000);
  const start = (day * n) % teams.length;
  return Array.from({ length: n }, (_, i) => teams[(start + i) % teams.length]);
}

/**
 * Expand a config into ytsearch source strings for this run.
 * @param {object} config - parsed config
 * @param {Date} [date] - rotation day (default: now)
 */
export function searchSources(config, date = new Date()) {
  const asList = (v) => (Array.isArray(v) ? v : []);
  const results = parseInt(config.search_results || 3, 10);
  const perRun = parseInt(config.search_teams_per_run ?? 3, 10);

  const queries = [...asList(config.search_queries)];
  const templates = asList(config.search_templates).filter(t => t.includes('{team}'));
  for (const team of rotateTeams(asList(config.search_teams), perRun, date)) {
    for (const t of templates) queries.push(t.replaceAll('{team}', team));
  }

  const seen = new Set();
  const out = [];
  for (const q of queries.map(s => s.trim()).filter(Boolean)) {
    if (seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    out.push(`ytsearch${results}:${q}`);
  }
  return out;
}
