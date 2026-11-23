import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CATALOG_VERSION, TOPICS, RELATED, SIGNALS, PUBLISHERS, AGENTS, BUYERS, SCALE, REQUESTS,
  LIVE_POLICIES, PROOF_PRINCIPALS, SENSITIVE_MEANINGS, TOPIC_WORDS, GEO_WORDS,
} from './data.js';
import { canon, demoKey, verifyText, signatureBase, sha256, b64, sha256hex } from './shared.js';

const SECRET = process.env.DEMO_SECRET || 'demo-secret-change-me';
const EPS_PER_ESTIMATE = 0.25; // privacy cost of one estimate
const BUDGET = 3.0; // per buyer company
const FLOOR = 25; // sample rows; below this no number is ever returned

export class ApiError extends Error {
  constructor(status, code, cls, detail, extra = {}) {
    super(detail);
    Object.assign(this, { status, body: { error: { code, class: cls, detail, ...extra } } });
  }
}

// ---------- signed tokens (quotes, budgets, segments): the API keeps no hidden state ----------
function mac(payload) {
  return createHmac('sha256', SECRET).update(canon(payload)).digest('base64url');
}
export function seal(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + mac(payload);
}
export function unseal(token, what) {
  try {
    const [body, sig] = String(token).split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    const ok = timingSafeEqual(Buffer.from(sig), Buffer.from(mac(payload)));
    if (ok) return payload;
  } catch {}
  throw new ApiError(400, 'INVALID_' + what.toUpperCase(), 'terminal', `The ${what} token was not issued by the registry or was altered.`);
}

// ---------- Cedar ----------
let cedarMod;
async function cedar() {
  if (!cedarMod) cedarMod = await import('@cedar-policy/cedar-wasm/nodejs');
  return cedarMod.default?.isAuthorized ? cedarMod.default : cedarMod;
}
function entities(principals) {
  return [
    ...principals.map((p) => ({ uid: { type: 'Agent', id: p.id }, attrs: { tier: p.tier }, parents: [] })),
    ...Object.entries(TOPICS).map(([id, t]) => ({ uid: { type: 'Signal', id }, attrs: { cls: t.cls }, parents: [] })),
  ];
}
async function decide(policies, principal, action, topic, ents) {
  const c = await cedar();
  const r = c.isAuthorized({
    principal: { type: 'Agent', id: principal.id }, action: { type: 'Action', id: action },
    resource: { type: 'Signal', id: topic }, context: {}, policies: { staticPolicies: policies }, entities: ents,
  });
  if (r.type !== 'success') throw new ApiError(400, 'POLICY_PARSE_ERROR', 'correctable', JSON.stringify(r.errors || r).slice(0, 300));
  return r.response.decision;
}

// Proof by exhaustion over the finite catalog: every principal tier x every signal x every action.
export async function prove(policies) {
  const ents = entities(PROOF_PRINCIPALS);
  const counterexamples = [], overBlocked = [];
  let checked = 0;
  for (const p of PROOF_PRINCIPALS)
    for (const [id, t] of Object.entries(TOPICS)) {
      const d = await decide(policies, p, 'target', id, ents); checked++;
      if (t.cls !== 'open' && d === 'allow') counterexamples.push({ principal: `${p.id} (tier ${p.tier})`, action: 'target', signal: id, class: t.cls });
      if (t.cls === 'open' && d === 'deny') overBlocked.push(id);
      await decide(policies, p, 'exclude', id, ents); checked++;
    }
  return {
    property: 'No principal can TARGET a sensitive or child-directed signal',
    proved: counterexamples.length === 0, cases_checked: checked, counterexamples,
    over_blocked_open_signals: [...new Set(overBlocked)],
    method: 'Exhaustive check of the finite demo catalog. Production would use Cedar Analysis (SMT).',
  };
}

// ---------- agent identity (Web Bot Auth style) ----------
export async function verifyAgent(req, path, rawBody) {
  // Standard Web Bot Auth headers, or the same values under x-sr- names. Some browsers,
  // proxies and AI browsing agents strip or overwrite the standard Signature headers in transit.
  const alt = req.headers.get('x-sr-signature') != null;
  const h = (n) => req.headers.get(alt ? 'x-sr-' + n : n);
  const agent = h('signature-agent');
  const input = h('signature-input') || '';
  const sig = (h('signature') || '').match(/sig=:(.+):/)?.[1];
  const digest = h('content-digest');
  if (!agent || !sig || !digest)
    throw new ApiError(401, 'UNSIGNED_REQUEST', 'terminal', 'Agents must sign every request (Web Bot Auth). No signature found.');
  if (!AGENTS[agent]) throw new ApiError(401, 'UNKNOWN_AGENT', 'terminal', `Agent "${agent}" is not registered at the gateway.`);
  const created = Number(input.match(/created=(\d+)/)?.[1]);
  if (!created || Math.abs(Date.now() / 1000 - created) > 300)
    throw new ApiError(401, 'STALE_SIGNATURE', 'transient', 'Signature is more than 5 minutes off server time; re-sign and retry.');
  if (digest !== 'sha-256=:' + b64(await sha256(rawBody || '')) + ':')
    throw new ApiError(401, 'DIGEST_MISMATCH', 'terminal', 'Body does not match its signed digest.');
  const { pub } = await demoKey(agent);
  if (!(await verifyText(signatureBase(req.method, path, created, digest), sig, pub)))
    throw new ApiError(401, 'BAD_SIGNATURE', 'terminal', 'Signature does not match the registered key.');
  return { id: agent, ...AGENTS[agent] };
}

// ---------- segment rules ----------
function condMatches(c, row) {
  const field = { 'context.topic': row.topic, 'context.intent_stage': row.intent_stage, 'geo.country': row.geo, 'device.type': row.device, browser: row.browser, 'publisher.id': row.publisher }[c.signal];
  const vals = c.op === 'eq' ? [c.value] : c.values;
  if (!vals.includes(field)) return false;
  if (c.signal === 'context.topic' && c.min_score && row.topic_score < c.min_score) return false;
  return true;
}
export function evaluate(node, row) {
  if (node.all) return node.all.every((n) => evaluate(n, row));
  if (node.any) return node.any.some((n) => evaluate(n, row));
  if (node.not) return !evaluate(node.not, row);
  return condMatches(node, row);
}

// Compile + validate against the catalog grammar and the live Cedar policy.
export async function validate(def, principal = { id: 'deal-desk', tier: 'internal' }) {
  const errors = [], targeted = [], excluded = [];
  let conditions = 0;
  const walk = (n, path, negated, depth) => {
    if (depth > 4) return errors.push({ path, code: 'TOO_DEEP', detail: 'Rules can be at most 4 levels deep.' });
    if (!n || typeof n !== 'object') return errors.push({ path, code: 'BAD_NODE', detail: 'Expected an object.' });
    if (n.all || n.any) {
      const k = n.all ? 'all' : 'any';
      if (!Array.isArray(n[k]) || !n[k].length) return errors.push({ path, code: 'EMPTY_GROUP', detail: `"${k}" needs at least one condition.` });
      return n[k].forEach((c, i) => walk(c, `${path}.${k}[${i}]`, negated, depth + 1));
    }
    if (n.not) return walk(n.not, `${path}.not`, !negated, depth + 1);
    conditions++;
    const spec = SIGNALS[n.signal];
    if (!spec) return errors.push({ path, code: 'UNKNOWN_SIGNAL', detail: `"${n.signal}" is not in ${CATALOG_VERSION}. Valid: ${Object.keys(SIGNALS).join(', ')}` });
    const vals = n.op === 'eq' ? [n.value] : n.values;
    if (!['in', 'eq'].includes(n.op) || !Array.isArray(vals) || !vals.length) return errors.push({ path, code: 'BAD_OPERATOR', detail: 'Use op "in" with values[], or "eq" with value.' });
    const bad = vals.filter((v) => !spec.values.includes(v));
    if (bad.length) errors.push({ path, code: 'UNKNOWN_VALUE', detail: `Not in catalog: ${bad.join(', ')}` });
    if (n.signal === 'context.topic') vals.forEach((v) => (negated ? excluded : targeted).push({ v, path }));
  };
  walk(def, '$', false, 0);
  if (conditions > 50) errors.push({ path: '$', code: 'TOO_MANY_CONDITIONS', detail: 'At most 50 conditions.' });
  if (!errors.length) {
    const ents = entities([principal]);
    for (const t of targeted)
      if ((await decide(LIVE_POLICIES, principal, 'target', t.v, ents)) === 'deny')
        errors.push({ path: t.path, code: 'POLICY_SENSITIVE_SIGNAL', detail: `"${t.v}" (${TOPICS[t.v].cls}) can be excluded, never targeted.` });
  }
  return { valid: errors.length === 0, errors, catalog: CATALOG_VERSION, hash: (await sha256hex(canon(def))).slice(0, 12) };
}

// ---------- estimates with differential privacy ----------
function laplace(scale) {
  const u = Math.random() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}
export function spendBudget(budgetToken, buyer) {
  const b = budgetToken ? unseal(budgetToken, 'budget') : { buyer, eps_left: BUDGET };
  if (b.buyer !== buyer) throw new ApiError(403, 'BUDGET_NOT_YOURS', 'terminal', 'Budget belongs to another buyer company.');
  if (b.eps_left < EPS_PER_ESTIMATE - 1e-9)
    throw new ApiError(429, 'PRIVACY_BUDGET_EXHAUSTED', 'terminal', 'This buyer company has used its question budget for today. Estimates pause until it resets.', { budget_token: seal(b), privacy_budget_left: 0 });
  const next = { buyer, eps_left: Math.round((b.eps_left - EPS_PER_ESTIMATE) * 100) / 100 };
  return { token: seal(next), left: next.eps_left / BUDGET };
}
export function estimate(def) {
  const rows = REQUESTS.filter((r) => evaluate(def, r));
  const scale = 1 / EPS_PER_ESTIMATE;
  const noisy = rows.length + laplace(scale);
  if (noisy < FLOOR) return { below_floor: true, detail: 'Too small to show. Segments this narrow could single people out.' };
  const sd = Math.SQRT2 * scale;
  const day = (x) => Math.max(0, Math.round((x * SCALE) / 1000) * 1000);
  const n = rows.length || 1;
  return {
    below_floor: false,
    daily_requests: { p10: day(noisy - 1.2816 * sd), p50: day(noisy), p90: day(noisy + 1.2816 * sd) },
    avg_cpm_usd: Math.round((rows.reduce((a, r) => a + r.cpm, 0) / n) * 100) / 100,
    safari_share: Math.round((rows.filter((r) => r.browser === 'safari').length / n) * 100) / 100,
    _rows: rows,
  };
}

// ---------- brief resolver (output constrained to catalog values) ----------
export function resolveBrief(brief) {
  for (const s of SENSITIVE_MEANINGS)
    if (s.re.test(brief))
      throw new ApiError(422, 'POLICY_SENSITIVE_MEANING', 'correctable',
        `Brief maps to "${TOPICS[s.topic].label}" (${TOPICS[s.topic].cls}). It can be excluded, never targeted.`,
        { matched_meaning: s.topic, alternatives: [s.alt] });
  const topics = [...new Set(TOPIC_WORDS.filter(([re]) => re.test(brief)).map(([, t]) => t))];
  const geos = [...new Set(GEO_WORDS.filter(([re]) => re.test(brief)).map(([, g]) => g))];
  if (!topics.length)
    throw new ApiError(422, 'BRIEF_UNMAPPED', 'correctable', 'No catalog topic matches this brief. Rephrase using one of the catalog topics.',
      { catalog_topics: Object.entries(TOPICS).filter(([, t]) => t.cls === 'open').map(([k]) => k) });
  const geo = geos.length ? [{ signal: 'geo.country', op: 'in', values: geos }] : [];
  const main = topics[0];
  const options = [
    { label: `${TOPICS[main].label}, comparing or buying${geos.length ? ', ' + geos.join('/') : ''}`,
      definition: { all: [{ signal: 'context.topic', op: 'in', values: topics, min_score: 0.7 }, { signal: 'context.intent_stage', op: 'in', values: ['compare', 'buy'] }, ...geo] },
      why: [`topic ${topics.join('|')} >= 0.7`, 'intent_stage compare|buy', ...(geos.length ? [`geo ${geos.join('|')}`] : [])] },
    { label: `${TOPICS[main].label}, any stage (more reach)${geos.length ? ', ' + geos.join('/') : ''}`,
      definition: { all: [{ signal: 'context.topic', op: 'in', values: topics, min_score: 0.5 }, ...geo] },
      why: [`topic ${topics.join('|')} >= 0.5`, ...(geos.length ? [`geo ${geos.join('|')}`] : [])] },
  ];
  if (RELATED[main])
    options.push({ label: `Adjacent: ${TOPICS[RELATED[main]].label}, ready to buy${geos.length ? ', ' + geos.join('/') : ''}`,
      definition: { all: [{ signal: 'context.topic', op: 'in', values: [RELATED[main]], min_score: 0.7 }, { signal: 'context.intent_stage', op: 'in', values: ['buy'] }, ...geo] },
      why: [`related topic ${RELATED[main]}`, 'intent_stage buy', ...(geos.length ? [`geo ${geos.join('|')}`] : [])] });
  return { options, catalog: CATALOG_VERSION };
}

export function categoryOf(def) {
  const found = [];
  const walk = (n, neg) => {
    if (n.all || n.any) return (n.all || n.any).forEach((c) => walk(c, neg));
    if (n.not) return walk(n.not, !neg);
    if (n.signal === 'context.topic' && !neg) n.values.forEach((v) => found.push(TOPICS[v].category));
  };
  walk(def, false);
  return [...new Set(found)];
}

export function makeQuote(def, est, label) {
  const q = {
    id: 'q_' + Math.random().toString(36).slice(2, 8), label, definition: def,
    categories: categoryOf(def), daily_requests: est.daily_requests, avg_cpm_usd: est.avg_cpm_usd,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
  return { ...q, token: seal(q) };
}

// ---------- mandates and publisher rules ----------
export async function checkMandate(m, quote, agent) {
  if (!m) throw new ApiError(403, 'MANDATE_REQUIRED', 'correctable', 'No buyer mandate attached. Ask the buyer to sign one, then retry.');
  const { sig, ...body } = m;
  if (!BUYERS[body.signed_by]) throw new ApiError(403, 'UNKNOWN_BUYER', 'terminal', 'Mandate signer is not a known buyer.');
  const { pub } = await demoKey(body.signed_by);
  if (!(await verifyText(canon(body), sig, pub))) throw new ApiError(403, 'BAD_MANDATE_SIGNATURE', 'terminal', 'Mandate signature does not match the buyer.');
  if (body.signed_by !== agent.buyer) throw new ApiError(403, 'MANDATE_NOT_FOR_AGENT', 'terminal', 'This agent does not act for the buyer who signed the mandate.');
  if (new Date(body.expires_at) < new Date()) throw new ApiError(403, 'MANDATE_EXPIRED', 'correctable', 'Mandate has expired; ask the buyer for a new one.');
  const outside = quote.categories.filter((c) => !body.categories.includes(c));
  if (outside.length) throw new ApiError(403, 'OUTSIDE_MANDATE_CATEGORIES', 'correctable', `Mandate does not cover: ${outside.join(', ')}.`);
  return body;
}
export function publisherCheck(def, categories) {
  const pubs = new Set(REQUESTS.filter((r) => evaluate(def, r)).map((r) => r.publisher));
  const excluded = PUBLISHERS.filter((p) => pubs.has(p.id) && p.blocked.some((b) => categories.includes(b))).map((p) => p.id);
  return { publishers_in_segment: pubs.size, excluded_publishers: excluded };
}

export async function receipt(type, summary) {
  const entry = { type, at: new Date().toISOString(), summary };
  return { ...entry, hash: await sha256hex(canon(entry)), registry_sig: mac(entry) };
}
