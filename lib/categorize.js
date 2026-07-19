/**
 * Video categorization — backward-compatible wrapper around classify.js.
 * Keeps the flat 16-category system working while the new multi-dimensional
 * classification runs underneath.
 */

import { classify, deriveLegacyCategory } from './classify.js';

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

/**
 * Classify a video and return both the legacy category and full classification.
 * @param {object} video - { title, channel, description, transcript }
 * @param {object} opts
 * @param {string} opts.model - Claude model
 * @returns {Promise<{ category: string, classification: object }>}
 */
export async function categorize(video, { model = 'ollama' } = {}) {
  const classification = await classify(video, { model });
  const category = deriveLegacyCategory(classification);
  return { category, classification };
}

export { classify, deriveLegacyCategory };
