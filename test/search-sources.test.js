import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSources, rotateTeams, isSearchSource } from '../lib/search-sources.js';
import { loadConfig } from '../lib/config.js';

const DAY = 86_400_000;

test('rotateTeams walks the list a window per day and wraps', () => {
  const teams = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(rotateTeams(teams, 2, new Date(0)), ['a', 'b']);
  assert.deepEqual(rotateTeams(teams, 2, new Date(DAY)), ['c', 'd']);
  assert.deepEqual(rotateTeams(teams, 2, new Date(2 * DAY)), ['e', 'a']);
  assert.deepEqual(rotateTeams(teams, 9, new Date(0)), teams);
  assert.deepEqual(rotateTeams([], 3), []);
});

test('searchSources expands templates per team plus fixed queries, deduped', () => {
  const out = searchSources({
    search_results: 2,
    search_teams_per_run: 1,
    search_queries: ['Madden 27 best defense', 'madden 27 BEST defense'],
    search_templates: ['stop the {team}', 'no placeholder here'],
    search_teams: ['Bills', 'Jets'],
  }, new Date(0));
  assert.deepEqual(out, ['ytsearch2:Madden 27 best defense', 'ytsearch2:stop the Bills']);
  assert.ok(out.every(isSearchSource));
});

test('a config without search keys adds no sources (main scraper unchanged)', async () => {
  assert.deepEqual(searchSources(await loadConfig('config.yaml')), []);
});

test('config.madden.yaml: 12 channels, all 32 teams, <=10 searches/day, no LLM or side feeds', async () => {
  const c = await loadConfig('config.madden.yaml');
  assert.equal(c.channels.length, 12);
  assert.ok(c.channels.every(u => /^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}$/.test(u)));
  assert.equal(new Set(c.search_teams).size, 32);
  for (let d = 0; d < 7; d++) {
    assert.ok(searchSources(c, new Date(d * DAY)).length <= 10);
  }
  const covered = new Set();
  for (let d = 0; d < 7; d++) rotateTeams(c.search_teams, c.search_teams_per_run, new Date(d * DAY)).forEach(t => covered.add(t));
  assert.equal(covered.size, 32);
  assert.equal(c.summarize, false);
  assert.equal(c.news_export, false);
  assert.equal(c.r2_sync, false);
  assert.equal(c.keep_srt, true);
  assert.equal(c.force_category, 'madden');
});
