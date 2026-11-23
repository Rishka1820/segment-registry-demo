// Helpers used by both the browser and the API (WebCrypto is available in both).
import * as ed from '@noble/ed25519';

export const enc = new TextEncoder();

export function b64(bytes) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
export function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}
export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
export async function sha256hex(text) {
  return hex(await sha256(text));
}

// Stable JSON: sorted keys, so the same object always hashes and signs the same way.
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object')
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

// Demo keys. In production each agent and buyer holds its own private key;
// here they are derived from public seeds so the demo can sign in the browser.
export async function demoKey(seed) {
  const priv = await sha256('demo-key:' + seed);
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub };
}
export async function signText(text, priv) {
  return b64(await ed.signAsync(enc.encode(text), priv));
}
export async function verifyText(text, sigB64, pub) {
  try {
    return await ed.verifyAsync(unb64(sigB64), enc.encode(text), pub);
  } catch {
    return false;
  }
}

// Web Bot Auth style request signing (simplified HTTP Message Signatures).
export function signatureBase(method, path, created, digest) {
  return `"@method": ${method}\n"@path": ${path}\n"content-digest": ${digest}\n"@signature-params": created=${created}`;
}
export async function signedHeaders(agentId, priv, method, path, body) {
  const created = Math.floor(Date.now() / 1000);
  const digest = 'sha-256=:' + b64(await sha256(body || '')) + ':';
  const sig = await signText(signatureBase(method, path, created, digest), priv);
  return {
    'content-digest': digest,
    'signature-agent': agentId,
    'signature-input': `sig=("@method" "@path" "content-digest");created=${created};keyid="${agentId}"`,
    signature: `sig=:${sig}:`,
  };
}

// Merkle root over a list of leaf hashes (hex). Used for the tamper-evident audit log.
export async function merkleRoot(leaves) {
  if (!leaves.length) return '';
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(await sha256hex(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}
