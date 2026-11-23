import { demoKey, signedHeaders } from '../../../lib/shared.js';
import { POST as v1Post, GET as v1Get, PATCH as v1Patch } from '../v1/[...path]/route.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Relay for the public demo agent. It signs the request with the demo agent's key on the
// server and passes it to the same API handler in-process, so the normal signature check
// still runs. Used only when the network path strips the browser's signature headers.
// Demo keys are public by design; production agents sign with their own private keys.
export async function POST(req) {
  const { method = 'POST', path = '', body = '' } = await req.json();
  if (!/^\/api\/v1\/[A-Za-z0-9_:\/{}-]+$/.test(path) || !['GET', 'POST', 'PATCH'].includes(method))
    return Response.json({ error: { code: 'BAD_RELAY_REQUEST', class: 'terminal', detail: 'Relay only forwards /api/v1 calls.' } }, { status: 400 });
  const { priv } = await demoKey('acme-agent');
  const headers = { 'content-type': 'application/json', ...(await signedHeaders('acme-agent', priv, method, path, body)) };
  const inner = new Request(new URL(path, req.url), { method, headers, body: method === 'GET' ? undefined : body });
  const ctx = { params: Promise.resolve({ path: path.replace(/^\/api\/v1\//, '').split('/') }) };
  const fn = { GET: v1Get, POST: v1Post, PATCH: v1Patch }[method];
  return fn(inner, ctx);
}
