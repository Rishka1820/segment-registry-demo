// Act as the demo buying agent from a terminal: signs requests the Web Bot Auth way.
// Usage: node scripts/agent.mjs https://your-app.vercel.app "UK runners for a trail-shoe launch"
import { demoKey, signedHeaders } from '../lib/shared.js';

const [base = 'http://localhost:3000', brief = 'UK runners for a trail-shoe launch'] = process.argv.slice(2);
const path = '/api/v1/briefs:resolve';
const body = JSON.stringify({ brief });
const { priv } = await demoKey('acme-agent');
const headers = { 'content-type': 'application/json', ...(await signedHeaders('acme-agent', priv, 'POST', path, body)) };
const res = await fetch(base + path, { method: 'POST', headers, body });
console.log(res.status, JSON.stringify(await res.json(), null, 2));
