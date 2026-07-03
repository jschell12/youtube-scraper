/**
 * Dedup ledger — mirrors news-scraper's seen.json pattern.
 * Tracks scraped video IDs to avoid re-processing.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * @typedef {Object} LedgerEntry
 * @property {string} title
 * @property {string} channel
 * @property {string} url
 * @property {string} firstScraped - ISO timestamp
 */

export class Ledger {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Record<string, LedgerEntry>} */
    this.data = {};
  }

  async load() {
    if (existsSync(this.filePath)) {
      const raw = await readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    }
    return this;
  }

  async save() {
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2) + '\n');
  }

  /**
   * Check if a video has been seen.
   * @param {string} videoId - YouTube video ID
   */
  hasSeen(videoId) {
    return videoId in this.data;
  }

  /**
   * Mark a video as seen.
   * @param {string} videoId
   * @param {object} meta
   */
  markSeen(videoId, { title, channel, category, url }) {
    this.data[videoId] = {
      title,
      channel,
      category,
      url,
      firstScraped: new Date().toISOString(),
    };
  }

  get size() {
    return Object.keys(this.data).length;
  }
}
