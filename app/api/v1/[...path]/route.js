import {
  ApiError, verifyAgent, validate, estimate, spendBudget, resolveBrief, makeQuote, unseal, seal,
  checkMandate, publisherCheck, receipt, prove,
} from '../../../../lib/engine.js';
import { CATALOG_VERSION, SIGNALS, TOPICS, LIVE_POLICIES } from '../../../../lib/data.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (status, body) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

function caller(req) {
  return req.headers.get('x-demo-user') === 'deal-desk' ? { id: 'deal-desk', tier: 'internal', buyer: 'internal-deal-desk' } : null;
}
async function agentOrDesk(req, path, raw) {
  return caller(req) || (await verifyAgent(req, path, raw));
}

async function handle(req, ctx) {
  const { path: parts } = await ctx.params;
  const route = parts.join('/');
  const url = new URL(req.url);
  const raw = req.method === 'GET' ? '' : await req.text();
  let body = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'BAD_JSON', 'correctable', 'Body is not valid JSON.'); }
  }
  const key = `${req.method} ${route}`;

  if (key === 'GET signals')
    return json(200, { catalog: CATALOG_VERSION, signals: Object.fromEntries(Object.entries(SIGNALS).map(([k, v]) => [k, { values: v.values }])),
      topic_classes: Object.fromEntries(Object.entries(TOPICS).map(([k, t]) => [k, t.cls])) });

  if (key === 'GET policies') return json(200, { live_policies: LIVE_POLICIES });

  if (key === 'POST policies:prove') {
    if (!body.policies) throw new ApiError(400, 'MISSING_POLICIES', 'correctable', 'Send { "policies": "<cedar text>" }.');
    return json(200, await prove(body.policies));
  }

  if (key === 'POST segments:validate') {
    const who = await agentOrDesk(req, url.pathname, raw);
    return json(200, await validate(body.definition, who));
  }

  if (key === 'POST segments:estimate') {
    const who = await agentOrDesk(req, url.pathname, raw);
    const v = await validate(body.definition, who);
    if (!v.valid) throw new ApiError(422, 'INVALID_SEGMENT', 'correctable', 'Fix the errors, then estimate.', { errors: v.errors });
    const budget = spendBudget(body.budget_token, who.buyer);
    const { _rows, ...est } = estimate(body.definition);
    return json(200, { ...est, unit: 'estimated eligible ad requests per day', period: 'trailing 7-day average, synthetic data', privacy_budget_left: budget.left, budget_token: budget.token, method: 'Laplace noise, epsilon 0.25 per question' });
  }

  if (key === 'POST briefs:resolve') {
    const agent = await verifyAgent(req, url.pathname, raw);
    if (!body.brief) throw new ApiError(400, 'MISSING_BRIEF', 'correctable', 'Send { "brief": "..." }.');
    const { options } = resolveBrief(body.brief);
    let token = body.budget_token, left = 1;
    const out = [];
    for (const o of options) {
      const v = await validate(o.definition, agent);
      if (!v.valid) continue;
      const b = spendBudget(token, agent.buyer); token = b.token; left = b.left;
      const { _rows, ...est } = estimate(o.definition);
      if (est.below_floor) continue;
      const q = makeQuote(o.definition, est, o.label);
      out.push({ label: o.label, definition: o.definition, why: o.why, segment_hash: v.hash,
        quote: { id: q.id, expires_at: q.expires_at, daily_requests: est.daily_requests, avg_cpm_usd: est.avg_cpm_usd, safari_share: est.safari_share, token: q.token } });
    }
    const r = await receipt('resolve', { agent: agent.id, brief: body.brief, options: out.map((o) => o.quote.id) });
    return json(200, { options: out, catalog: CATALOG_VERSION, privacy_budget_left: left, budget_token: token, receipt: r });
  }

  if (req.method === 'POST' && route === 'segments') {
    if (!caller(req)) throw new ApiError(403, 'NOT_ALLOWED', 'terminal', 'Agents choose among registry segments; only internal users create them.');
    const v = await validate(body.definition);
    if (!v.valid) throw new ApiError(422, 'INVALID_SEGMENT', 'correctable', 'Fix the errors first.', { errors: v.errors });
    const seg = { id: 'seg_' + v.hash.slice(0, 6), version: 1, name: body.name || 'Untitled', definition: body.definition, hash: v.hash, created_at: new Date().toISOString() };
    return json(201, { ...seg, segment_token: seal(seg), receipt: await receipt('segment.create', { id: seg.id, version: 1, hash: v.hash }) });
  }

  if (req.method === 'PATCH' && /^segments\/[^/]+$/.test(route)) {
    if (!caller(req)) throw new ApiError(403, 'NOT_ALLOWED', 'terminal', 'Only internal users edit segments.');
    const prev = unseal(body.segment_token, 'segment');
    const v = await validate(body.definition);
    if (!v.valid) throw new ApiError(422, 'INVALID_SEGMENT', 'correctable', 'Fix the errors first.', { errors: v.errors });
    const seg = { ...prev, version: prev.version + 1, definition: body.definition, hash: v.hash, created_at: new Date().toISOString() };
    return json(200, { ...seg, segment_token: seal(seg), previous_version_unchanged: `${prev.id}@${prev.version}`,
      receipt: await receipt('segment.version', { id: seg.id, version: seg.version, hash: v.hash }) });
  }

  const commit = route.match(/^quotes\/([^/]+):commit$/);
  if (req.method === 'POST' && commit) {
    const agent = await verifyAgent(req, url.pathname, raw);
    const quote = unseal(body.quote_token, 'quote');
    if (quote.id !== commit[1]) throw new ApiError(400, 'QUOTE_MISMATCH', 'terminal', 'Token does not belong to this quote ID.');
    if (new Date(quote.expires_at) < new Date()) throw new ApiError(409, 'QUOTE_EXPIRED', 'correctable', 'Quote expired; resolve again for a fresh quote.');
    const mandate = await checkMandate(body.mandate, quote, agent);
    const pub = publisherCheck(quote.definition, quote.categories);
    const sv = await validate(quote.definition);
    const activation = { segment: 'seg_' + sv.hash.slice(0, 6) + '@1', label: quote.label, activation: 'act_' + Math.random().toString(36).slice(2, 7), deal_id: body.deal_id || 'mn-demo-deal', quote: quote.id,
      checks: ['agent_signature:pass', 'buyer_mandate:pass', `publisher_rules:pass (${pub.excluded_publishers.length} of ${pub.publishers_in_segment} publishers excluded by their own rules)`, 'policy:pass'],
      excluded_publishers: pub.excluded_publishers, mandate_spend_cap_usd: mandate.max_spend_usd };
    return json(200, { ...activation, receipt: await receipt('commit', { agent: agent.id, segment: activation.segment, quote: quote.id, mandate: mandate.id, activation: activation.activation }) });
  }

  if (key === 'GET ' || key === 'GET index')
    return json(200, { name: 'Segment Registry demo API', endpoints: ['GET /api/v1/signals', 'GET /api/v1/policies', 'POST /api/v1/policies:prove',
      'POST /api/v1/segments:validate', 'POST /api/v1/segments:estimate', 'POST /api/v1/segments', 'PATCH /api/v1/segments/{id}',
      'POST /api/v1/briefs:resolve (signed agents)', 'POST /api/v1/quotes/{id}:commit (signed agents + mandate)'] });

  throw new ApiError(404, 'NOT_FOUND', 'terminal', `No endpoint for ${req.method} /api/v1/${route}`);
}

async function wrapped(req, ctx) {
  try {
    return await handle(req, ctx);
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, e.body);
    console.error(e);
    return json(500, { error: { code: 'INTERNAL', class: 'transient', detail: String(e.message || e) } });
  }
}
export const GET = wrapped, POST = wrapped, PATCH = wrapped;
