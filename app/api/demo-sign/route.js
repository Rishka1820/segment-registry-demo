import { demoKey, signedHeaders } from '../../../lib/shared.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fallback signer for the public demo agent, used only if the browser cannot sign.
// Demo keys are public by design; production agents hold their own private keys.
export async function POST(req) {
  const { method, path, body } = await req.json();
  const { priv } = await demoKey('acme-agent');
  return Response.json(await signedHeaders('acme-agent', priv, method, path, body || ''));
}
