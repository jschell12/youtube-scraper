/**
 * Export scraped videos as `_youtube-videos.md` day files for the
 * news pipeline (trading-platform sentiment ingestion).
 *
 * Scans output day dirs (YYYY-MM-DD) for transcript markdown files and
 * regenerates one table-format file per day under NEWS_MD_DIR:
 *
 *   ## All Posts
 *   | # | Channel | Category | Kind | Date | Duration | Tickers | Title |
 *
 * The 8-column "discovery" shape matches trading-platform's youtube-md
 * parser: c[4]=date, c[6]=comma-separated tickers ("—" = none), c[7]=linked
 * title. Regeneration is idempotent — the whole day file is rewritten.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CASHTAG_RE = /\$([A-Za-z]{1,5})(?![A-Za-z])/g;
const BARE_RE = /(?<![\w$#@])([A-Z]{2,5})(?![\w])/g;

// Common all-caps words that are not (or are rarely meant as) tickers.
// Mirrors discord-scraper/scraper/tickers.py.
const BLOCKLIST = new Set([
  'A', 'I', 'OK', 'NO', 'YES', 'SO', 'TO', 'IN', 'ON', 'AT', 'BY', 'OF',
  'OR', 'AND', 'THE', 'FOR', 'NOT', 'BUT', 'ALL', 'ANY', 'CAN', 'GET',
  'GOT', 'HAS', 'HAD', 'HIS', 'HER', 'ITS', 'NEW', 'NOW', 'OLD', 'ONE',
  'OUT', 'OWN', 'SEE', 'WAY', 'WHO', 'WHY', 'YOU', 'TWO', 'USE', 'TOP',
  'LOL', 'LMAO', 'OMG', 'WTF', 'TBH', 'IMO', 'IMHO', 'FYI', 'ASAP',
  'IDK', 'IRL', 'SMH', 'BTW', 'DM', 'DMS', 'PSA', 'RIP', 'GG', 'GL',
  'HODL', 'YOLO', 'FOMO', 'MOON', 'PUMP', 'DUMP', 'BUY', 'SELL', 'HOLD',
  'CALL', 'CALLS', 'PUT', 'PUTS', 'STOP', 'LIMIT', 'OPEN', 'CLOSE',
  'HIGH', 'LOW', 'UP', 'DOWN', 'RED', 'GREEN', 'BIG', 'HUGE', 'REAL',
  'GOOD', 'BAD', 'BEST', 'NICE', 'WOW', 'YEAH', 'NAH', 'BRO', 'GUYS',
  'THIS', 'THAT', 'WHAT', 'WHEN', 'WILL', 'WITH', 'JUST', 'ONLY',
  'MORE', 'MOST', 'SOME', 'VERY', 'MUCH', 'BEEN', 'HERE', 'THERE',
  'TODAY', 'AGAIN', 'NEVER', 'GOING', 'STILL',
  'USD', 'USA', 'US', 'UK', 'EU', 'IPO', 'ETF', 'CEO', 'CFO', 'CTO',
  'COO', 'SEC', 'FDA', 'FED', 'GDP', 'CPI', 'PPI', 'EPS', 'PE', 'PT',
  'ATH', 'ATL', 'AH', 'PM', 'AM', 'EST', 'EDT', 'PST', 'PDT', 'UTC',
  'DD', 'TA', 'FA', 'PR', 'ER', 'EOY', 'EOD', 'EOW', 'YTD', 'YOY',
  'RS', 'TF', 'STFU', 'GTFO', 'AF', 'NGL', 'ONG', 'FR', 'RN', 'TY',
  'QOQ', 'ROI', 'ROE', 'ROCE', 'EBITDA', 'NAV', 'AUM', 'OTC', 'NYSE',
  'IV', 'OI', 'ITM', 'OTM', 'ATM', 'LEAPS', 'FD', 'FDS',
  'MACD', 'RSI', 'SMA', 'EMA', 'VWAP', 'MC', 'FF', 'SI', 'CTB',
  'PDUFA', 'NDA', 'BLA', 'CRL', 'ODAC', 'ADCOM', 'P1', 'P2', 'P3',
  'AI', 'ML', 'API', 'APP', 'WEB', 'NET', 'IT', 'PC', 'TV', 'GPU',
  'CPU', 'RAM', 'URL', 'PDF', 'GIF', 'JPEG', 'PNG', 'HTML',
]);

/**
 * Extract tickers: cashtags from title + transcript, bare uppercase
 * symbols from the title only (transcripts are too noisy for bare matches).
 */
export function extractTickers(title, transcript = '') {
  const found = [];
  const seen = new Set();
  for (const m of `${title}\n${transcript}`.matchAll(CASHTAG_RE)) {
    const sym = m[1].toUpperCase();
    if (!seen.has(sym) && !BLOCKLIST.has(sym)) { seen.add(sym); found.push(sym); }
  }
  for (const m of title.matchAll(BARE_RE)) {
    const sym = m[1];
    if (!seen.has(sym) && !BLOCKLIST.has(sym)) { seen.add(sym); found.push(sym); }
  }
  return found;
}

/** Parse a transcript markdown file written by lib/scrape.js. */
export function parseTranscriptMd(content) {
  const title = (content.match(/^#\s+(.+)/m) || [])[1] || '';
  const meta = (name) => (content.match(new RegExp(`^- \\*\\*${name}\\*\\*: (.*)$`, 'm')) || [])[1] || '';
  const idx = content.indexOf('## Transcript');
  const transcript = idx === -1 ? '' : content.slice(idx + '## Transcript'.length);
  return {
    title: title.trim(),
    channel: meta('Channel').trim(),
    date: meta('Date').trim(),
    duration: meta('Duration').trim(),
    category: meta('Category').trim(),
    kind: meta('Kind').trim(),
    url: meta('URL').trim(),
    transcript,
  };
}

/**
 * Extract tickers from a summary file's "## Tickers Discussed" table
 * (financial-category summaries list them as [MSFT](robinhood-link) rows).
 */
export function extractSummaryTickers(content) {
  const found = [];
  const idx = content.search(/^##\s+Tickers Discussed/mi);
  if (idx === -1) return found;
  const rest = content.slice(idx + 2); // skip past the heading's own "##"
  const next = rest.search(/\n##\s/);
  const section = next === -1 ? rest : rest.slice(0, next);
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const first = line.split('|').map(s => s.trim()).filter(Boolean)[0] || '';
    if (/^:?-{2,}:?$/.test(first) || /^ticker$/i.test(first)) continue;
    const sym = ((first.match(/\[([A-Za-z.]{1,6})\]/) || first.match(/^([A-Z.]{1,6})$/)) || [])[1];
    if (sym && !found.includes(sym.toUpperCase())) found.push(sym.toUpperCase());
  }
  return found;
}

/** Markdown-table-safe cell text (no pipes, no link-breaking brackets). */
function cellSafe(s) {
  return (s || '').replace(/[|[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function exportDay(outputDir, newsDir, day) {
  const dayDir = path.join(outputDir, day);
  let files;
  try {
    files = (await readdir(dayDir)).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  } catch {
    return 0;
  }
  if (files.length === 0) return 0;

  const rows = [];
  for (const file of files.sort()) {
    const v = parseTranscriptMd(await readFile(path.join(dayDir, file), 'utf8'));
    if (!v.title) continue;
    const tickers = extractTickers(v.title, v.transcript);
    // Financial summaries carry a curated "Tickers Discussed" table — merge it in.
    try {
      const summary = await readFile(path.join(dayDir, `_summary-${file}`), 'utf8');
      for (const sym of extractSummaryTickers(summary)) {
        if (!tickers.includes(sym)) tickers.push(sym);
      }
    } catch { /* no summary file */ }
    const date = DAY_RE.test(v.date) ? v.date : day;
    const title = v.url ? `[${cellSafe(v.title)}](${v.url})` : cellSafe(v.title);
    rows.push(
      `| ${rows.length + 1} | ${cellSafe(v.channel)} | ${v.category || '—'} | ${v.kind || '—'} `
      + `| ${date} | ${v.duration || '—'} | ${tickers.length ? tickers.join(', ') : '—'} | ${title} |`
    );
  }
  if (rows.length === 0) return 0;

  const outDayDir = path.join(newsDir, day);
  await mkdir(outDayDir, { recursive: true });
  const md = [
    `# YouTube Videos (${day})`,
    '',
    `Auto-generated by youtube-scraper for news-pipeline ingestion. ${rows.length} video(s).`,
    '',
    '## All Posts',
    '',
    '| # | Channel | Category | Kind | Date | Duration | Tickers | Title |',
    '|---|---------|----------|------|------|----------|---------|-------|',
    ...rows,
    '',
  ].join('\n');
  await writeFile(path.join(outDayDir, '_youtube-videos.md'), md);
  return rows.length;
}

/**
 * Export the last `days` day dirs (or all with days=Infinity) from
 * outputDir into newsDir as `_youtube-videos.md` files.
 */
export async function exportNewsMd(outputDir, newsDir, { days = 3 } = {}) {
  let entries;
  try {
    entries = (await readdir(outputDir, { withFileTypes: true }))
      .filter(e => e.isDirectory() && DAY_RE.test(e.name))
      .map(e => e.name)
      .sort()
      .reverse();
  } catch {
    return { days: 0, videos: 0 };
  }
  if (Number.isFinite(days)) entries = entries.slice(0, days);

  let total = 0, dayCount = 0;
  for (const day of entries) {
    const n = await exportDay(outputDir, newsDir, day);
    if (n > 0) { total += n; dayCount++; }
  }
  return { days: dayCount, videos: total };
}
