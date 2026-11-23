# Segment Registry: Agent Console (demo)

A working prototype for the Media.net APM case study, Topic 3: an internal API for targeting segments,
designed for its newest and riskiest caller, AI buying agents.

Left: a buyer agent. Right: the live API trace. Real HTTP endpoints, synthetic data only.

## The scenes
1. **An unknown agent knocks.** Unsigned request: rejected (401).
2. **"UK runners for a trail-shoe launch".** Three real segments, each with a quote and reasons.
3. **"Expecting parents, first trimester".** Caught by meaning, refused with a safe alternative (422).
4. **Agent tries to buy on its own.** No buyer mandate: blocked (403).
5. **Buyer signs, agent buys.** Buyer mandate and publisher rules both pass; two publishers excluded by their own rules.
6. **A sneaky agent probes for individuals.** Only "below floor" answers; the question budget runs out (429).
7. **Someone loosens the rules.** The Cedar policy edit fails its proof, with counterexamples.
8. **Someone edits the audit log.** The Merkle root no longer matches.

Plus a **Deal desk** tab: a person builds a segment, sees its estimate, saves version 1, edits, and saves version 2
while the deal stays pinned to version 1.

## What is real
- Ed25519 request signatures in the style of Web Bot Auth (HTTP Message Signatures), checked on the server.
- Signed buyer mandates (Ed25519), checked for signer, categories and expiry.
- Cedar policies evaluated by Cedar's own WebAssembly package (`@cedar-policy/cedar-wasm`).
- Laplace noise (differential privacy) and a question budget per buyer company.
- SHA-256 Merkle root over audit receipts.
- Quotes, budgets and segment versions are HMAC-signed tokens, so the API keeps no hidden state.

## Honest simplifications
- The "proof" checks every case in the small demo catalog. Production would use Cedar Analysis (SMT).
- The brief resolver uses a fixed phrase table that can only output catalog values; production would use a
  small language model with constrained decoding.
- Demo keys are derived from public seeds so the browser can sign. Real agents and buyers hold private keys.
- The privacy budget travels as a signed token; production keeps it server-side per buyer company.

## Run locally
```
npm install
npm run dev        # http://localhost:3000
node scripts/agent.mjs http://localhost:3000 "beach holiday deals for US families"
```

## Deploy (about 2 minutes)
1. Push this folder to a GitHub repository.
2. On vercel.com: Add New > Project > import the repository > Deploy. No settings needed.
3. Optional: add an environment variable `DEMO_SECRET` with any random string.

## API
| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/v1/signals` | anyone | Catalog of targetable signals |
| `POST /api/v1/briefs:resolve` | signed agent | Brief to up to 3 quoted segments |
| `POST /api/v1/segments:validate`, `:estimate` | deal desk or signed agent | Check and size a segment |
| `POST /api/v1/segments`, `PATCH /api/v1/segments/{id}` | deal desk | Create and version |
| `POST /api/v1/quotes/{id}:commit` | signed agent + buyer mandate | Buy a quoted segment |
| `GET /api/v1/policies`, `POST /api/v1/policies:prove` | anyone | Live rules and the proof check |

Deal desk calls use the header `x-demo-user: deal-desk` as a stand-in for company sign-in.
