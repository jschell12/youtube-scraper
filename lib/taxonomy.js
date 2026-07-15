/**
 * Video classification taxonomy.
 * Separates what a video IS ABOUT (domain/topics) from what it IS DOING (primary_kind).
 * Single source of truth for all valid kinds, domains, dimensions, and mappings.
 */

export const TAXONOMY = {
  products_and_purchasing: {
    label: 'Products & Purchasing',
    legacyCategory: 'product-review',
    kinds: {
      product_overview: 'Explains what a product is and its main features',
      product_review: 'Evaluates a product after use or testing',
      product_comparison: 'Compares two or more products',
      buying_guide: 'Helps viewers select from a product category',
      unboxing: 'Opens and initially examines a product',
      first_impressions: 'Early opinion without extensive testing',
      long_term_review: 'Evaluation after extended use',
      setup_guide: 'Shows how to install or configure a product',
      troubleshooting: 'Diagnoses and fixes a product problem',
      deal_analysis: 'Evaluates whether a price or promotion is worthwhile',
      product_news: 'Covers announcements, launches, recalls, or updates',
      sponsored_promotion: 'Primarily promotes a product or service',
    },
  },
  cooking_and_food: {
    label: 'Cooking & Food',
    legacyCategory: 'cooking',
    kinds: {
      recipe_tutorial: 'Step-by-step preparation of a dish',
      cooking_technique: 'Teaches a general method such as searing or frying',
      recipe_review: 'Tests or evaluates an existing recipe',
      recipe_comparison: 'Compares multiple ways to make the same dish',
      meal_planning: 'Plans meals around cost, nutrition, or convenience',
      food_review: 'Evaluates food, a restaurant, or packaged item',
      restaurant_review: 'Reviews a specific restaurant or dining experience',
      nutrition_explainer: 'Discusses calories, macros, ingredients, or health effects',
      food_science: 'Explains why cooking processes work',
      kitchen_equipment_review: 'Evaluates cookware or appliances',
    },
  },
  investing_and_finance: {
    label: 'Investing & Finance',
    legacyCategory: 'financial',
    kinds: {
      ticker_due_diligence: 'Detailed investment analysis of a company or security',
      bull_thesis: 'Presents reasons an investment may rise',
      bear_thesis: 'Presents risks or reasons an investment may decline',
      earnings_analysis: 'Analyzes an earnings report or call',
      valuation_analysis: 'Estimates fair value using financial metrics or models',
      catalyst_analysis: 'Examines upcoming events that may affect an investment',
      technical_analysis: 'Uses charts, price action, or indicators',
      short_squeeze_analysis: 'Examines float, short interest, options, and squeeze potential',
      portfolio_update: 'Creator discusses changes to personal holdings',
      trade_setup: 'Presents an entry, exit, stop, or options strategy',
      financial_news: 'Reports recent market or company developments',
      market_recap: 'Summarizes market activity over a period',
      macro_analysis: 'Discusses rates, inflation, employment, or economic policy',
      personal_finance_education: 'Covers budgeting, debt, retirement, taxes, or insurance',
      financial_product_review: 'Reviews brokers, credit cards, accounts, or financial services',
      crypto_analysis: 'Evaluates cryptocurrencies or blockchain projects',
    },
  },
  news_and_current_events: {
    label: 'News & Current Events',
    legacyCategory: 'news',
    kinds: {
      breaking_news: 'Reports a newly occurring event',
      news_summary: 'Summarizes multiple recent stories',
      news_analysis: 'Explains implications or context around the news',
      opinion_commentary: 'Gives a personal interpretation of events',
      political_analysis: 'Analyzes politicians, elections, legislation, or policy',
      geopolitical_analysis: 'Covers international relations or conflict',
      fact_check: 'Investigates whether a claim is accurate',
      interview_news: 'Uses an interview to discuss current events',
      documentary_news: 'Long-form reporting on a current issue',
    },
  },
  technology_and_software: {
    label: 'Technology & Software',
    legacyCategory: 'tech',
    kinds: {
      software_tutorial: 'Teaches how to use software or a technical tool',
      programming_tutorial: 'Builds or explains code',
      technical_explainer: 'Explains a technology or architecture',
      project_build: 'Documents building a software or hardware project',
      code_review: 'Reviews or critiques source code',
      architecture_review: 'Evaluates a system design',
      benchmark: 'Measures performance under controlled conditions',
      software_comparison: 'Compares applications, frameworks, or services',
      devops_guide: 'Covers infrastructure, deployment, reliability, or operations',
      cybersecurity_analysis: 'Discusses vulnerabilities, attacks, or defenses',
      technology_news: 'Reports developments in technology',
      ai_research_explainer: 'Explains an AI paper, model, or technique',
      workflow_automation: 'Shows how to automate a process',
    },
  },
  education_and_explanation: {
    label: 'Education & Explanation',
    legacyCategory: 'informational',
    kinds: {
      concept_explainer: 'Explains a subject or idea',
      how_to_tutorial: 'Gives step-by-step instructions',
      lecture: 'Structured educational presentation',
      course_lesson: 'A lesson within a larger curriculum',
      case_study: 'Examines a specific real-world example',
      historical_explainer: 'Explains a historical event or period',
      scientific_explainer: 'Explains scientific research or concepts',
      myth_busting: 'Challenges common misconceptions',
      frequently_asked_questions: 'Answers a collection of common questions',
      study_guide: 'Helps prepare for a test or certification',
    },
  },
  entertainment_and_media: {
    label: 'Entertainment & Media',
    legacyCategory: 'entertainment',
    kinds: {
      movie_review: 'Evaluates a film',
      tv_review: 'Evaluates a television series or episode',
      game_review: 'Evaluates a video game',
      media_analysis: 'Analyzes themes, characters, or production',
      reaction: 'Records reactions to other content or events',
      recap: 'Summarizes a story, episode, game, or event',
      trailer_analysis: 'Breaks down a trailer or preview',
      ranking: 'Ranks items from best to worst',
      retrospective: 'Reexamines older media or events',
      comedy: 'Primarily intended to be humorous',
      sketch: 'Scripted short-form performance',
      storytelling: 'Narrates a personal or fictional story',
    },
  },
  gaming: {
    label: 'Gaming',
    legacyCategory: 'gaming',
    kinds: {
      gameplay: 'Primarily shows someone playing a game',
      walkthrough: 'Guides viewers through game content',
      strategy_guide: 'Teaches tactics or decision-making',
      build_guide: 'Recommends a character, equipment, or skill configuration',
      tips_and_tricks: 'Provides a collection of useful techniques',
      game_news: 'Reports updates, releases, or industry developments',
      patch_analysis: 'Analyzes changes introduced by an update',
      competitive_analysis: 'Breaks down high-level competitive play',
      lore_explainer: 'Explains a game story or world',
      challenge_run: 'Gameplay under unusual restrictions',
      speedrun: 'Attempts to finish content as quickly as possible',
    },
  },
  health_and_fitness: {
    label: 'Health & Fitness',
    legacyCategory: 'health-fitness',
    kinds: {
      workout_tutorial: 'Demonstrates an exercise or workout',
      training_program: 'Provides a structured fitness plan',
      nutrition_guidance: 'Gives dietary or meal advice',
      medical_explainer: 'Explains a condition, treatment, or medication',
      health_product_review: 'Evaluates a health-related product',
      weight_loss_guidance: 'Discusses methods for losing weight',
      personal_health_journey: 'Documents an individual experience',
      research_review: 'Discusses clinical studies or scientific evidence',
      myth_busting_health: 'Corrects health or fitness misconceptions',
    },
  },
  travel_and_places: {
    label: 'Travel & Places',
    legacyCategory: 'travel',
    kinds: {
      travel_guide: 'Explains what to see, do, or know at a destination',
      travel_vlog: 'Documents a personal trip',
      hotel_review: 'Evaluates lodging',
      destination_comparison: 'Compares places to visit or live',
      itinerary: 'Provides a structured travel schedule',
      travel_tips: 'Gives advice on transportation, packing, costs, or safety',
      relocation_guide: 'Discusses moving to a location',
      local_documentary: 'Explores the culture or history of a place',
    },
  },
  business_and_careers: {
    label: 'Business & Careers',
    legacyCategory: 'business',
    kinds: {
      business_case_study: 'Examines how a company succeeded or failed',
      company_analysis: 'Explains a company operations and strategy',
      industry_analysis: 'Analyzes a market or business sector',
      entrepreneurship_advice: 'Gives guidance on starting or growing a business',
      marketing_guide: 'Covers advertising, branding, or customer acquisition',
      career_advice: 'Gives guidance on jobs and professional development',
      interview_preparation: 'Helps prepare for job interviews',
      workplace_commentary: 'Discusses employment trends or workplace culture',
      income_report: 'Creator reveals business or creator earnings',
    },
  },
  personal_and_lifestyle: {
    label: 'Personal & Lifestyle',
    legacyCategory: 'entertainment',
    kinds: {
      personal_vlog: 'Documents daily life or personal events',
      personal_story: 'Recounts a specific experience',
      advice: 'Gives recommendations about life decisions',
      self_improvement: 'Discusses habits, productivity, or personal development',
      routine: 'Shows a morning, evening, work, or fitness routine',
      home_improvement: 'Demonstrates repairs or renovations',
      organization_guide: 'Covers cleaning, storage, or organization',
      parenting_guidance: 'Discusses childcare or family issues',
      relationship_advice: 'Discusses romantic or interpersonal relationships',
    },
  },
  interviews_and_discussions: {
    label: 'Interviews & Discussions',
    legacyCategory: 'entertainment',
    kinds: {
      interview: 'One person questions another',
      podcast_conversation: 'Long-form informal discussion',
      panel_discussion: 'Multiple participants discuss a topic',
      debate: 'Participants argue opposing positions',
      question_and_answer: 'Responds to audience or interviewer questions',
      expert_roundtable: 'Multiple specialists analyze a subject',
      testimonial: 'Someone describes their experience with a product or service',
    },
  },
  investigative_and_documentary: {
    label: 'Investigative & Documentary',
    legacyCategory: 'informational',
    kinds: {
      documentary: 'Structured factual narrative about a subject',
      investigation: 'Attempts to uncover hidden or disputed facts',
      true_crime: 'Examines an alleged or confirmed crime',
      scam_exposure: 'Investigates deceptive behavior',
      corporate_exposé: 'Investigates a company conduct',
      internet_mystery: 'Investigates an unexplained online event',
      biography: 'Tells the story of a person life',
      event_reconstruction: 'Reconstructs how an event happened',
    },
  },
};

// Kinds that map to a different legacy category than their domain default
const KIND_LEGACY_OVERRIDES = {
  kitchen_equipment_review: 'product-review',
  health_product_review: 'product-review',
  financial_product_review: 'product-review',
  home_improvement: 'diy-crafts',
  organization_guide: 'diy-crafts',
  scientific_explainer: 'science',
  game_review: 'gaming',
};

// Derived lookup tables (built once at import time)
export const ALL_KINDS = new Set();
export const KIND_TO_DOMAIN = {};
export const DOMAIN_TO_LEGACY = {};

for (const [domain, { legacyCategory, kinds }] of Object.entries(TAXONOMY)) {
  DOMAIN_TO_LEGACY[domain] = legacyCategory;
  for (const kind of Object.keys(kinds)) {
    ALL_KINDS.add(kind);
    KIND_TO_DOMAIN[kind] = domain;
  }
}

/**
 * Get the legacy category for a primary_kind.
 */
export function kindToLegacy(kind) {
  if (KIND_LEGACY_OVERRIDES[kind]) return KIND_LEGACY_OVERRIDES[kind];
  const domain = KIND_TO_DOMAIN[kind];
  return domain ? DOMAIN_TO_LEGACY[domain] : 'other';
}

// Valid dimension values
export const CONTENT_INTENTS = [
  'inform', 'explain', 'teach', 'demonstrate', 'review', 'compare',
  'recommend', 'persuade', 'entertain', 'report', 'investigate',
  'document', 'speculate', 'sell', 'warn', 'debunk',
];

export const EVIDENCE_STYLES = [
  'personal_experience', 'hands_on_testing', 'controlled_benchmark',
  'official_sources', 'financial_filings', 'scientific_research',
  'expert_interview', 'anecdotal_evidence', 'community_opinion',
  'news_reporting', 'technical_documentation', 'unsourced_opinion',
];

export const TIME_SENSITIVITIES = ['evergreen', 'low', 'medium', 'high', 'breaking'];

export const PRESENTATION_FORMATS = [
  'talking_head', 'screen_recording', 'voiceover', 'demonstration',
  'presentation', 'interview', 'podcast', 'documentary', 'livestream',
  'compilation', 'reaction', 'vlog', 'animation',
];

export const RECOMMENDATION_POSTURES = [
  'strong_buy', 'buy', 'consider', 'neutral', 'avoid', 'strong_avoid', 'not_applicable',
];

/**
 * Build the taxonomy section of the classification prompt.
 */
export function buildTaxonomyPrompt() {
  const lines = [];
  for (const [, { label, kinds }] of Object.entries(TAXONOMY)) {
    lines.push(`\n### ${label}`);
    for (const [kind, desc] of Object.entries(kinds)) {
      lines.push(`- ${kind}: ${desc}`);
    }
  }
  return lines.join('\n');
}
