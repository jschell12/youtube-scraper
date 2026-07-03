/**
 * Video categorization via Claude CLI.
 * Classifies a video into one category based on title, description, and transcript.
 */

import { callClaude } from './claude.js';

export const CATEGORIES = [
  'informational',
  'financial',
  'product-review',
  'travel',
  'entertainment',
  'news',
  'gaming',
  'tech',
  'health-fitness',
  'cooking',
  'diy-crafts',
  'sports',
  'science',
  'business',
  'music',
  'other',
];

const CATEGORY_DESCRIPTIONS = `
- informational: how-to, explainer, educational, tutorial
- financial: market analysis, investing, stock picks, crypto, economics
- product-review: reviews, comparisons, unboxings, buying guides
- travel: travel vlogs, destination guides, hotel/flight reviews
- entertainment: comedy, vlogs, pranks, challenges, reaction videos
- news: current events, politics, journalism, breaking news
- gaming: gameplay, game reviews, esports, walkthroughs
- tech: software, hardware, programming, AI, gadgets
- health-fitness: workouts, nutrition, mental health, medical info
- cooking: recipes, restaurant reviews, food science, mukbang
- diy-crafts: home improvement, woodworking, art, maker projects
- sports: highlights, analysis, training, athlete profiles
- science: research, experiments, space, nature, documentaries
- business: entrepreneurship, marketing, career advice, startups
- music: performances, production, instrument tutorials, music reviews
- other: anything that doesn't fit the above categories
`.trim();

/**
 * Categorize a video using Claude.
 * @param {object} video - { title, description, transcript }
 * @param {object} opts
 * @param {string} opts.model - Claude model
 * @returns {string} One of CATEGORIES
 */
export async function categorize(video, { model = 'haiku' } = {}) {
  const snippet = (video.transcript || '').split(/\s+/).slice(0, 400).join(' ');

  const prompt = `Classify this YouTube video into exactly ONE category. Respond with ONLY the category name, nothing else.

Categories:
${CATEGORY_DESCRIPTIONS}

Title: ${video.title}
Channel: ${video.channel || ''}
Description: ${(video.description || '').slice(0, 300)}

Transcript excerpt:
${snippet}

Category:`;

  const result = await callClaude(prompt, { model, timeout: 30_000 });
  const category = result.trim().toLowerCase().replace(/[^a-z-]/g, '');

  if (CATEGORIES.includes(category)) return category;

  // Fuzzy match: find closest category if Claude returned a slight variant
  const match = CATEGORIES.find(c => category.includes(c) || c.includes(category));
  return match || 'other';
}
