import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { TAXONOMY } from '../lib/taxonomy.js';

const app = express();
app.use(express.json());

const outputDir = process.env.YOUTUBE_OUTPUT_DIR || './output';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const CATEGORIES = [
  'informational', 'financial', 'product-review', 'travel',
  'entertainment', 'news', 'gaming', 'tech',
  'health-fitness', 'cooking', 'diy-crafts', 'sports',
  'science', 'business', 'music', 'other',
];

// --- helpers ---

function readSeen() {
  const p = path.join(outputDir, 'seen.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

function today() { return new Date().toISOString().slice(0, 10); }

/** Extract date from seen.json firstScraped or fall back to searching day dirs */
function videoDate(id, seen) {
  const entry = seen[id];
  if (entry?.firstScraped) return entry.firstScraped.slice(0, 10);
  // fallback: scan day dirs
  try {
    const dirs = fs.readdirSync(outputDir).filter(d => DAY_RE.test(d)).sort().reverse();
    for (const d of dirs) {
      const files = fs.readdirSync(path.join(outputDir, d));
      if (files.some(f => f.startsWith(id) && f.endsWith('.md') && !f.startsWith('_summary-'))) return d;
    }
  } catch { /* ignore */ }
  return null;
}

/** Find the transcript, summary, and classification files for a videoId */
function findVideoFiles(id, dayDir) {
  try {
    const files = fs.readdirSync(dayDir);
    const transcript = files.find(f => f.startsWith(id) && f.endsWith('.md') && !f.startsWith('_summary-'));
    const summary = files.find(f => f.startsWith(`_summary-${id}`) && f.endsWith('.md'));
    const classification = files.find(f => f.startsWith(`_classify-${id}`) && f.endsWith('.json'));
    return { transcript, summary, classification };
  } catch { return { transcript: null, summary: null, classification: null }; }
}

// --- routes ---

// Health
app.get('/api/health', (req, res) => {
  const seen = readSeen();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    outputDir,
    videoCount: Object.keys(seen).length,
    containerized: process.env.CONTAINERIZED === 'true',
  });
});

// Days
app.get('/api/days', (req, res) => {
  try {
    if (!fs.statSync(outputDir).isDirectory()) return res.json({ days: [] });
  } catch { return res.json({ days: [] }); }

  if (req.query.dateBy === 'publish') {
    // Return unique video upload dates from the ledger
    const seen = readSeen();
    const dateSet = new Set();
    for (const entry of Object.values(seen)) {
      if (entry.uploadDate) dateSet.add(entry.uploadDate);
    }
    const days = [...dateSet].sort().reverse();
    return res.json({ count: days.length, days });
  }

  const days = fs.readdirSync(outputDir)
    .filter(d => DAY_RE.test(d) && fs.statSync(path.join(outputDir, d)).isDirectory())
    .sort()
    .reverse();

  res.json({ count: days.length, days });
});

// Categories (includes domains for the new classification system)
app.get('/api/categories', (_req, res) => {
  const domains = Object.entries(TAXONOMY).map(([key, { label, legacyCategory }]) => ({
    key,
    label,
    legacyCategory,
  }));
  res.json({ categories: CATEGORIES, domains });
});

// Videos list
app.get('/api/videos', (req, res) => {
  const date = req.query.date || today();
  const categoryFilter = req.query.category || null;
  const kindFilter = req.query.kind || null;
  const domainFilter = req.query.domain || null;
  const dateBy = req.query.dateBy || null;
  const seen = readSeen();

  if (dateBy === 'publish') {
    // Filter across all scrape days by video upload date
    const videos = [];
    const seenIds = new Set();
    let dirs;
    try {
      dirs = fs.readdirSync(outputDir).filter(d => DAY_RE.test(d)).sort().reverse();
    } catch { dirs = []; }

    for (const d of dirs) {
      const dayDir = path.join(outputDir, d);
      const files = fs.readdirSync(dayDir)
        .filter(f => f.endsWith('.md') && !f.startsWith('_summary-'));
      for (const f of files) {
        const match = f.match(/^([A-Za-z0-9_-]{11})-(.+)\.md$/);
        if (!match) continue;
        const id = match[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const entry = seen[id] || {};
        if (entry.uploadDate !== date) continue;
        if (categoryFilter && entry.category !== categoryFilter) continue;
        if (kindFilter && entry.primaryKind !== kindFilter) continue;
        if (domainFilter && entry.domain !== domainFilter) continue;
        videos.push({
          id,
          title: entry.title || match[2].replace(/-/g, ' '),
          channel: entry.channel || null,
          category: entry.category || null,
          primaryKind: entry.primaryKind || null,
          domain: entry.domain || null,
          url: entry.url || null,
          date: entry.uploadDate || d,
        });
      }
    }
    return res.json({ date, count: videos.length, videos });
  }

  const dayDir = path.join(outputDir, date);

  if (!fs.existsSync(dayDir)) return res.json({ date, videos: [] });

  const files = fs.readdirSync(dayDir)
    .filter(f => f.endsWith('.md') && !f.startsWith('_summary-'));

  const videos = [];
  for (const f of files) {
    // filename pattern: <videoId>-<slug>.md
    const match = f.match(/^([A-Za-z0-9_-]{11})-(.+)\.md$/);
    if (!match) continue;
    const id = match[1];
    const entry = seen[id] || {};
    if (categoryFilter && entry.category !== categoryFilter) continue;
    if (kindFilter && entry.primaryKind !== kindFilter) continue;
    if (domainFilter && entry.domain !== domainFilter) continue;
    videos.push({
      id,
      title: entry.title || match[2].replace(/-/g, ' '),
      channel: entry.channel || null,
      category: entry.category || null,
      primaryKind: entry.primaryKind || null,
      domain: entry.domain || null,
      url: entry.url || null,
      date,
    });
  }

  res.json({ date, count: videos.length, videos });
});

// Single video
app.get('/api/videos/:id', (req, res) => {
  const id = req.params.id;
  const seen = readSeen();
  const entry = seen[id];
  const date = videoDate(id, seen);

  if (!date) return res.status(404).json({ error: 'video not found' });

  const dayDir = path.join(outputDir, date);
  const { transcript: tFile, summary: sFile, classification: cFile } = findVideoFiles(id, dayDir);

  if (!tFile) return res.status(404).json({ error: 'transcript file not found' });

  const transcript = fs.readFileSync(path.join(dayDir, tFile), 'utf-8');
  const summary = sFile ? fs.readFileSync(path.join(dayDir, sFile), 'utf-8') : null;

  let classification = null;
  if (cFile) {
    try {
      classification = JSON.parse(fs.readFileSync(path.join(dayDir, cFile), 'utf-8'));
    } catch { /* ignore parse errors */ }
  }

  res.json({
    id,
    title: entry?.title || null,
    channel: entry?.channel || null,
    category: entry?.category || null,
    classification,
    url: entry?.url || null,
    date,
    transcript,
    summary,
  });
});

// Search
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  if (!q) return res.status(400).json({ error: 'q parameter required' });

  const seen = readSeen();
  const results = [];

  // 1. Search seen.json titles/channels
  for (const [id, entry] of Object.entries(seen)) {
    const haystack = `${entry.title || ''} ${entry.channel || ''} ${entry.category || ''} ${entry.primaryKind || ''}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        id,
        title: entry.title,
        channel: entry.channel,
        category: entry.category,
        primaryKind: entry.primaryKind || null,
        domain: entry.domain || null,
        url: entry.url,
        date: entry.firstScraped?.slice(0, 10) || null,
        matchSource: 'metadata',
        snippet: null,
      });
    }
    if (results.length >= limit) break;
  }

  // 2. Search transcript files (only if under limit)
  if (results.length < limit) {
    const seenIds = new Set(results.map(r => r.id));
    try {
      const dirs = fs.readdirSync(outputDir).filter(d => DAY_RE.test(d)).sort().reverse();
      outer:
      for (const d of dirs) {
        const dayDir = path.join(outputDir, d);
        const files = fs.readdirSync(dayDir)
          .filter(f => f.endsWith('.md') && !f.startsWith('_summary-'));
        for (const f of files) {
          const match = f.match(/^([A-Za-z0-9_-]{11})-/);
          if (!match || seenIds.has(match[1])) continue;
          const id = match[1];
          try {
            const content = fs.readFileSync(path.join(dayDir, f), 'utf-8');
            const idx = content.toLowerCase().indexOf(q);
            if (idx === -1) continue;
            const start = Math.max(0, idx - 60);
            const end = Math.min(content.length, idx + q.length + 60);
            const snippet = (start > 0 ? '...' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '...' : '');
            const entry = seen[id] || {};
            results.push({
              id,
              title: entry.title || null,
              channel: entry.channel || null,
              category: entry.category || null,
              primaryKind: entry.primaryKind || null,
              domain: entry.domain || null,
              url: entry.url || null,
              date: d,
              matchSource: 'transcript',
              snippet,
            });
            seenIds.add(id);
            if (results.length >= limit) break outer;
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* ignore */ }
  }

  res.json({ query: q, count: results.length, results });
});

// Scrape (disabled)
app.post('/api/scrape', (_req, res) => {
  res.status(501).json({
    error: 'Scraping requires yt-dlp + Claude CLI. This endpoint is not available via the API.',
  });
});

export default app;
