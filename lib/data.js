// Synthetic catalog and traffic. No real user data anywhere.

export const CATALOG_VERSION = 'catalog-v14';

// Every value an agent can ever target. The brief resolver can only output these (constrained output).
export const TOPICS = {
  'running': { cls: 'open', category: 'sporting_goods', label: 'Running' },
  'trail-running': { cls: 'open', category: 'sporting_goods', label: 'Trail running' },
  'football': { cls: 'open', category: 'sporting_goods', label: 'Football' },
  'travel-beach': { cls: 'open', category: 'travel', label: 'Beach holidays' },
  'travel-city': { cls: 'open', category: 'travel', label: 'City breaks' },
  'cooking': { cls: 'open', category: 'food', label: 'Cooking' },
  'personal-finance': { cls: 'open', category: 'finance', label: 'Personal finance' },
  'tech-phones': { cls: 'open', category: 'electronics', label: 'Smartphones' },
  'gaming': { cls: 'open', category: 'entertainment', label: 'Gaming' },
  'parenting-baby-gear': { cls: 'open', category: 'baby_products', label: 'Baby gear' },
  'health-pregnancy': { cls: 'sensitive', category: 'health', label: 'Pregnancy' },
  'health-diabetes': { cls: 'sensitive', category: 'health', label: 'Diabetes' },
  'health-mental': { cls: 'sensitive', category: 'health', label: 'Mental health' },
  'religion': { cls: 'sensitive', category: 'religion', label: 'Religion' },
  'politics': { cls: 'sensitive', category: 'politics', label: 'Politics' },
  'kids-content': { cls: 'minors', category: 'kids', label: 'Child-directed content' },
};
export const RELATED = {
  'trail-running': 'running', 'running': 'trail-running', 'football': 'running',
  'travel-beach': 'travel-city', 'travel-city': 'travel-beach', 'cooking': 'parenting-baby-gear',
  'tech-phones': 'gaming', 'gaming': 'tech-phones', 'personal-finance': 'tech-phones',
  'parenting-baby-gear': 'cooking',
};
export const INTENTS = ['learn', 'compare', 'buy', 'fix', 'browse'];
export const GEOS = ['GB', 'US', 'IN', 'CA', 'DE'];
export const DEVICES = ['mobile', 'desktop'];
export const BROWSERS = ['chrome', 'safari', 'other'];
export const SIGNALS = {
  'context.topic': { values: Object.keys(TOPICS), scored: true },
  'context.intent_stage': { values: INTENTS },
  'geo.country': { values: GEOS },
  'device.type': { values: DEVICES },
  'browser': { values: BROWSERS },
  'publisher.id': { values: Array.from({ length: 40 }, (_, i) => 'pub_' + (i + 1)) },
};

// Publishers and their signed rules: categories they refuse.
export const PUBLISHERS = Array.from({ length: 40 }, (_, i) => ({
  id: 'pub_' + (i + 1),
  blocked: i === 6 || i === 21 ? ['sporting_goods'] : i % 9 === 0 ? ['finance'] : [],
}));

// Agents registered at the gateway (Web Bot Auth key IDs) and their trust tier.
export const AGENTS = { 'acme-agent': { tier: 'standard', buyer: 'acme-media' } };
export const BUYERS = { 'acme-media': { name: 'Acme Media (buyer)' } };

// One sample row stands for this many real daily requests.
export const SCALE = 400;

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(r, arr, weights) {
  if (!weights) return arr[Math.floor(r() * arr.length)];
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < arr.length; i++) if ((x -= weights[i]) < 0) return arr[i];
  return arr[arr.length - 1];
}

const TOPIC_KEYS = Object.keys(TOPICS);
const TOPIC_W = [12, 6, 10, 7, 8, 10, 7, 9, 8, 6, 3, 2, 3, 2, 4, 3];
const CPM = { sporting_goods: 2.1, travel: 2.6, food: 1.4, finance: 3.2, electronics: 2.4, entertainment: 1.6, baby_products: 1.9, health: 2.8, religion: 1.1, politics: 1.8, kids: 0.9 };

export const REQUESTS = (() => {
  const r = rng(20261123);
  return Array.from({ length: 10000 }, (_, i) => {
    const topic = pick(r, TOPIC_KEYS, TOPIC_W);
    return {
      id: 'req_' + i,
      topic,
      topic_score: Math.round((0.45 + r() * 0.55) * 100) / 100,
      intent_stage: pick(r, INTENTS, [30, 22, 14, 14, 20]),
      geo: pick(r, GEOS, [30, 35, 15, 10, 10]),
      device: pick(r, DEVICES, [65, 35]),
      browser: pick(r, BROWSERS, [58, 33, 9]),
      publisher: 'pub_' + (1 + Math.floor(r() * 40)),
      cpm: Math.round(CPM[TOPICS[topic].category] * (0.7 + r() * 0.6) * 100) / 100,
    };
  });
})();

// Cedar policies that are live in the registry.
export const LIVE_POLICIES = `// Open signals can be targeted by any registered agent
permit(principal, action == Action::"target", resource)
  when { resource.cls == "open" };

// Any signal, even a sensitive one, can be used to EXCLUDE
permit(principal, action == Action::"exclude", resource);

// Sensitive and child-directed signals can never be targeted
forbid(principal, action == Action::"target", resource)
  when { resource.cls != "open" };`;

// A tempting edit someone might propose: "trusted agents may target health".
export const RISKY_POLICIES = `// Open signals can be targeted by any registered agent
permit(principal, action == Action::"target", resource)
  when { resource.cls == "open" };

// Any signal, even a sensitive one, can be used to EXCLUDE
permit(principal, action == Action::"exclude", resource);

// EDIT: only block child-directed content...
forbid(principal, action == Action::"target", resource)
  when { resource.cls == "minors" };

// EDIT: ...and let premium agents target sensitive health topics
permit(principal, action == Action::"target", resource)
  when { resource.cls == "sensitive" && principal.tier == "premium" };`;

export const PROOF_PRINCIPALS = [
  { id: 'acme-agent', tier: 'standard' },
  { id: 'any-premium-agent', tier: 'premium' },
  { id: 'deal-desk', tier: 'internal' },
];

// Meaning-based check: phrases that map to sensitive concepts, however they are worded.
export const SENSITIVE_MEANINGS = [
  { re: /(expect(ing)?\s+(parents|mums?|moms?|a baby)|pregnan|trimester|baby bump|morning sickness)/i, topic: 'health-pregnancy', alt: 'Baby-gear pages, intent stage compare' },
  { re: /(diabet|blood sugar|insulin)/i, topic: 'health-diabetes', alt: 'Cooking pages, intent stage learn' },
  { re: /(depress|anxiety|mental health|therapy|stressed out)/i, topic: 'health-mental', alt: 'Personal-finance or travel pages, no health signals' },
  { re: /(church|mosque|temple|muslim|christian|hindu|jewish|religio)/i, topic: 'religion', alt: 'Travel or cooking pages by country' },
  { re: /(voters?|democrat|republican|conservative|liberal|election)/i, topic: 'politics', alt: 'News-free lifestyle pages by country' },
  { re: /(kids?|children|teen(ager)?s?|under\s*18|school ?kids)/i, topic: 'kids-content', alt: 'Parents shopping for baby gear, intent buy' },
];

export const TOPIC_WORDS = [
  [/trail/i, 'trail-running'], [/(running|runner|marathon|jog)/i, 'running'], [/(football|soccer)/i, 'football'],
  [/beach/i, 'travel-beach'], [/(city break|travel|holiday|vacation)/i, 'travel-city'], [/(recipe|cook|kitchen)/i, 'cooking'],
  [/(phone|smartphone|mobile handset)/i, 'tech-phones'], [/(gaming|gamer|video game)/i, 'gaming'],
  [/(baby gear|stroller|pram|nappies|diapers)/i, 'parenting-baby-gear'], [/(finance|invest|savings|budgeting)/i, 'personal-finance'],
];
export const GEO_WORDS = [
  [/\b(uk|britain|british|england|london)\b/i, 'GB'], [/\b(us|usa|america|american)\b/i, 'US'],
  [/\b(india|indian)\b/i, 'IN'], [/\b(canada|canadian)\b/i, 'CA'], [/\b(germany|german)\b/i, 'DE'],
];
