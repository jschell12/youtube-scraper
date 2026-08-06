/**
 * Multi-dimensional video classification via Claude CLI.
 * Produces rich structured classification: primary_kind, secondary_kinds,
 * domain, topics, content_intent, evidence_style, entities, etc.
 */

import { callClaude } from './claude.js';
import {
  ALL_KINDS,
  KIND_TO_DOMAIN,
  buildTaxonomyPrompt,
  kindToLegacy,
  CONTENT_INTENTS,
  EVIDENCE_STYLES,
  TIME_SENSITIVITIES,
} from './taxonomy.js';

/**
 * @typedef {Object} Classification
 * @property {string} primary_kind
 * @property {string[]} secondary_kinds
 * @property {string} domain
 * @property {string[]} topics
 * @property {string[]} content_intent
 * @property {string} time_sensitivity
 * @property {string[]} evidence_style
 * @property {Object} entities
 * @property {string[]} [entities.products]
 * @property {string[]} [entities.companies]
 * @property {string[]} [entities.tickers]
 * @property {string[]} [entities.people]
 * @property {string[]} audience
 * @property {string} summary
 * @property {number} confidence
 */

const FALLBACK = {
  primary_kind: 'concept_explainer',
  secondary_kinds: [],
  domain: 'education_and_explanation',
  topics: [],
  content_intent: ['inform'],
  time_sensitivity: 'low',
  evidence_style: ['unsourced_opinion'],
  entities: {},
  audience: ['general'],
  summary: '',
  confidence: 0.3,
};

/**
 * Classify a video using Claude CLI with multi-dimensional output.
 * @param {object} video - { title, channel, description, transcript }
 * @param {object} opts
 * @param {string} opts.model
 * @returns {Promise<Classification>}
 */
export async function classify(video, { model = 'ollama' } = {}) {
  // Sample beginning + middle + end so long videos (podcasts, livestreams)
  // aren't classified from their intro alone.
  const words = (video.transcript || '').split(/\s+/);
  let snippet;
  if (words.length <= 600) {
    snippet = words.join(' ');
  } else {
    const mid = Math.floor(words.length / 2);
    snippet = [
      '[start] ' + words.slice(0, 300).join(' '),
      '[middle] ' + words.slice(mid, mid + 200).join(' '),
      '[end] ' + words.slice(-100).join(' '),
    ].join('\n...\n');
  }

  const prompt = `You are a YouTube video classifier. Analyze this video and produce a structured classification.

## Primary Kinds (pick exactly ONE as primary_kind, zero or more as secondary_kinds)
${buildTaxonomyPrompt()}

## Content Intent (pick 1-3)
${CONTENT_INTENTS.join(', ')}

## Evidence Style (pick 1-3)
${EVIDENCE_STYLES.join(', ')}

## Time Sensitivity (pick ONE)
${TIME_SENSITIVITIES.join(', ')}

## Video

Title: ${video.title}
Channel: ${video.channel || ''}
Duration: ${video.duration_string || 'unknown'}${video.duration >= 3600 ? ' (long-form — likely a livestream, podcast, or extended discussion rather than a scripted explainer)' : ''}
Description: ${(video.description || '').slice(0, 300)}

Transcript excerpt:
${snippet}

## Output

Respond with ONLY valid JSON, no markdown fences, no explanation:
{"primary_kind":"one_kind_from_above","secondary_kinds":["other_applicable_kinds"],"domain":"short_domain_label","topics":["specific_topics"],"content_intent":["from_list"],"time_sensitivity":"from_list","evidence_style":["from_list"],"entities":{"products":[],"companies":[],"tickers":[],"people":[]},"audience":["target_audience"],"summary":"One sentence describing what this video does","confidence":0.85}`;

  let result;
  try {
    result = await callClaude(prompt, { model, timeout: 60_000 });
  } catch (err) {
    console.warn(`  Classification failed, using fallback: ${err.message}`);
    return { ...FALLBACK, summary: video.title };
  }

  return parseClassification(result, video.title);
}

/**
 * Parse and validate Claude's classification JSON output.
 */
function parseClassification(raw, fallbackTitle) {
  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/```$/g, '').trim();
    const json = JSON.parse(cleaned);

    // Validate primary_kind
    if (!json.primary_kind || !ALL_KINDS.has(json.primary_kind)) {
      const match = [...ALL_KINDS].find(k =>
        json.primary_kind?.includes(k) || k.includes(json.primary_kind || '')
      );
      json.primary_kind = match || 'concept_explainer';
    }

    // Filter secondary_kinds to valid values
    json.secondary_kinds = (json.secondary_kinds || []).filter(k => ALL_KINDS.has(k));

    // Derive domain from primary_kind if missing
    json.domain = json.domain || KIND_TO_DOMAIN[json.primary_kind] || 'education_and_explanation';

    // Ensure arrays
    json.topics = json.topics || [];
    json.content_intent = json.content_intent || ['inform'];
    json.evidence_style = json.evidence_style || [];
    json.audience = json.audience || [];
    json.entities = json.entities || {};

    // Clean entity arrays (remove nulls/empties)
    for (const key of ['products', 'companies', 'tickers', 'people']) {
      if (json.entities[key]) {
        json.entities[key] = json.entities[key].filter(Boolean);
        if (json.entities[key].length === 0) delete json.entities[key];
      }
    }

    // Validate time_sensitivity
    if (!TIME_SENSITIVITIES.includes(json.time_sensitivity)) {
      json.time_sensitivity = 'low';
    }

    // Ensure confidence is a number in [0, 1]
    json.confidence = typeof json.confidence === 'number'
      ? Math.max(0, Math.min(1, json.confidence))
      : 0.5;

    // Ensure summary
    json.summary = json.summary || fallbackTitle;

    return json;
  } catch {
    return { ...FALLBACK, summary: fallbackTitle };
  }
}

/**
 * Derive legacy category from a classification object.
 */
export function deriveLegacyCategory(classification) {
  return kindToLegacy(classification.primary_kind);
}
