'use client';
import { useState } from 'react';
import { demoKey, signedHeaders, canon, signText, sha256hex, merkleRoot } from '../lib/shared.js';
import { LIVE_POLICIES, RISKY_POLICIES, TOPICS, INTENTS, GEOS } from '../lib/data.js';

const SCENES = [
  { id: 'unsigned', icon: '🚪', title: 'Unknown agent knocks', note: 'No signature, no entry.' },
  { id: 'brief', icon: '🏃', title: 'Brief: UK trail runners', note: 'Plain English in, 3 priced segments out.' },
  { id: 'sensitive', icon: '🤰', title: 'Brief: expecting parents', note: 'Caught by meaning, not keywords. Safe alternative offered.' },
  { id: 'nomandate', icon: '💳', title: 'Agent buys on its own', note: 'Blocked: no buyer signature, no spend.' },
  { id: 'commit', icon: '✍️', title: 'Buyer signs, agent buys', note: 'Buyer and publisher signatures both pass. 2 publishers opt out automatically.' },
  { id: 'probe', icon: '🕵️', title: 'Agent probes for individuals', note: 'Sees only “below floor”, then runs out of questions.' },
  { id: 'policy', icon: '⚖️', title: 'Someone loosens the rules', note: 'Unsafe edit proven wrong before it ships.' },
  { id: 'tamper', icon: '🧾', title: 'Someone edits the audit log', note: 'One changed word breaks the seal.' },
];
const NODES = [
  ['auth', '1 · Who is calling?', 'Signed request (Web Bot Auth)'],
  ['meaning', '2 · What do they want?', 'Brief → catalog values; sensitive-meaning check'],
  ['quote', '3 · What can they buy?', 'Segment options, reach range, 15-min quote'],
  ['privacy', '4 · Can they learn too much?', 'Noise, reach floor, question budget'],
  ['mandate', '5 · Is the buyer’s money safe?', 'Buyer-signed mandate: cap, category, expiry'],
  ['pub', '6 · Do publishers agree?', 'Each publisher’s own signed rules'],
  ['audit', '7 · Can anyone check later?', 'Append-only log, Merkle root'],
];
function plain(t) {
  const r = t.res || {};
  if (r.error) return ({ UNSIGNED_REQUEST: 'Blocked: no signature', POLICY_SENSITIVE_MEANING: 'Blocked: sensitive topic (' + (r.error.matched_meaning || '') + ')', PRIVACY_BUDGET_EXHAUSTED: 'Blocked: question budget used up' })[r.error.code] || ('Blocked: ' + (r.error.code || '').toLowerCase().replace(/_/g, ' '));
  if (r.options) return r.options.length + ' priced options returned';
  if (t.path.includes(':commit')) return 'Deal live. Publisher rules applied';
  if (t.path.includes('segments:estimate')) return r.below_floor ? 'Below floor: no number shown' : 'Noisy estimate returned';
  return 'OK';
}
function flowFrom(f, path, status, signed) {
  const n = { ...f };
  const ok = status < 300;
  if (!signed) { return { auth: 'bad' }; }
  n.auth = 'ok';
  if (path.includes('briefs:resolve')) { n.meaning = ok ? 'ok' : 'bad'; if (ok) { n.quote = 'ok'; n.audit = 'ok'; } }
  if (path.includes(':commit')) { n.mandate = ok ? 'ok' : 'bad'; if (ok) { n.pub = 'ok'; n.audit = 'ok'; } }
  if (path.includes('segments:estimate')) { n.privacy = ok ? 'ok' : 'bad'; }
  return n;
}
const BLANK_MANDATE = { id: 'mdt_91', signed_by: 'acme-media', max_spend_usd: 50000, categories: ['sporting_goods'], expires_at: '2026-12-31T00:00:00Z' };

export default function Page() {
  const [tab, setTab] = useState('agent');
  const [trace, setTrace] = useState([]);
  const [options, setOptions] = useState([]);
  const [budget, setBudget] = useState({ token: null, left: 1 });
  const [mandate, setMandate] = useState(null);
  const [audit, setAudit] = useState([]);
  const [roots, setRoots] = useState([]);
  const [note, setNote] = useState('Pick a scene. Every click calls the real API.');
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState('');
  const [policies, setPolicies] = useState(LIVE_POLICIES);
  const [proof, setProof] = useState(null);
  const [verify, setVerify] = useState(null);
  const [flow, setFlow] = useState({});
  const [cur, setCur] = useState(null);

  async function addReceipt(r) {
    if (!r) return;
    setAudit((a) => {
      const next = [...a, r];
      merkleRoot(next.map((e) => e.hash)).then((root) => setRoots((rs) => [...rs, root]));
      return next;
    });
  }
  async function call(method, path, body, { signed = true, desk = false, label } = {}) {
    const raw = body ? JSON.stringify(body) : '';
    const headers = { 'content-type': 'application/json' };
    if (signed) Object.assign(headers, await signedHeaders('acme-agent', (await demoKey('acme-agent')).priv, method, path, raw));
    if (desk) headers['x-demo-user'] = 'deal-desk';
    const res = await fetch(path, { method, headers, body: raw || undefined });
    const data = await res.json();
    setTrace((t) => [{ label, method, path, status: res.status, req: body, res: data, signed, at: new Date().toLocaleTimeString() }, ...t]);
    setFlow((f) => flowFrom(f, path, res.status, signed));
    if (data.budget_token) setBudget({ token: data.budget_token, left: data.privacy_budget_left ?? 0 });
    if (data.receipt) addReceipt(data.receipt);
    return { status: res.status, data };
  }
  async function resolve(text) {
    const { status, data } = await call('POST', '/api/v1/briefs:resolve', { brief: text, budget_token: budget.token }, { label: 'Agent sends a brief' });
    if (status === 200) setOptions(data.options);
    return data;
  }
  async function signMandate() {
    const { priv } = await demoKey('acme-media');
    const m = { ...BLANK_MANDATE, sig: await signText(canon(BLANK_MANDATE), priv) };
    setMandate(m);
    return m;
  }
  async function buy(opt, m) {
    return call('POST', `/api/v1/quotes/${opt.quote.id}:commit`, { quote_token: opt.quote.token, mandate: m || undefined, deal_id: 'mn-acme-4471' }, { label: m ? 'Agent commits with mandate' : 'Agent commits without mandate' });
  }

  async function run(id) {
    const s = SCENES.find((x) => x.id === id);
    setNote(s.note); setBusy(true); setCur(id);
    try {
      if (id === 'unsigned') await call('POST', '/api/v1/briefs:resolve', { brief: 'UK runners for a trail-shoe launch' }, { signed: false, label: 'Unsigned request' });
      if (id === 'brief') await resolve('UK runners for a trail-shoe launch, Nov-Dec');
      if (id === 'sensitive') await resolve('expecting parents, first trimester');
      if (id === 'nomandate' || id === 'commit') {
        let opts = options;
        if (!opts.length) opts = (await resolve('UK runners for a trail-shoe launch, Nov-Dec')).options || [];
        if (id === 'nomandate') await buy(opts[0], null);
        else await buy(opts[0], mandate || (await signMandate()));
      }
      if (id === 'probe') {
        const steps = [['running'], ['running', 'CA'], ['running', 'CA', 'desktop'], ['running', 'CA', 'desktop', 'safari'], ['running', 'CA', 'desktop', 'safari', 'pub_7']];
        let token = budget.token;
        for (let round = 0; round < 3; round++)
          for (const st of steps) {
            const all = [{ signal: 'context.topic', op: 'in', values: [st[0]] }];
            if (st[1]) all.push({ signal: 'geo.country', op: 'in', values: [st[1]] });
            if (st[2]) all.push({ signal: 'device.type', op: 'in', values: [st[2]] });
            if (st[3]) all.push({ signal: 'browser', op: 'in', values: [st[3]] });
            if (st[4]) all.push({ signal: 'publisher.id', op: 'in', values: [st[4]] });
            const { status, data } = await call('POST', '/api/v1/segments:estimate', { definition: { all }, budget_token: token }, { label: `Probe: ${st.join(' + ')}` });
            token = data.budget_token || token;
            if (status !== 200) return;
          }
      }
      if (id === 'policy') { setTab('policy'); setPolicies(RISKY_POLICIES); await runProof(RISKY_POLICIES); }
      if (id === 'tamper') {
        setTab('audit');
        if (!audit.length) await resolve('UK runners for a trail-shoe launch, Nov-Dec');
      }
    } finally { setBusy(false); }
  }
  async function runProof(text) {
    const r = await fetch('/api/v1/policies:prove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ policies: text ?? policies }) });
    setProof(await r.json());
  }
  async function verifyLog() {
    const recomputed = [];
    for (const e of audit) recomputed.push(await sha256hex(canon({ type: e.type, at: e.at, summary: e.summary })));
    const root = await merkleRoot(recomputed);
    const published = roots[roots.length - 1];
    const bad = audit.map((e, i) => (recomputed[i] !== e.hash ? i : -1)).filter((i) => i >= 0);
    setVerify({ ok: root === published, root, published, bad });
  }
  function tamper() {
    if (!audit.length) return;
    setAudit((a) => a.map((e, i) => (i === 0 ? { ...e, summary: { ...e.summary, agent: 'someone-else' } } : e)));
    setVerify(null);
  }

  return (
    <main>
      <header>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:14}}><div className="brand">media<i>.</i>net</div><div><h1>Segment Registry <span>Agent Console</span></h1>
          <p className="sub">Demo for an agent-ready internal API for targeting segments. Real endpoints, synthetic data, demo keys.</p></div></div>
        </div>
        <nav>{[['agent', 'Agent console'], ['desk', 'Deal desk'], ['policy', 'Policy lab'], ['audit', 'Audit log'], ['api', 'API']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>))}</nav>
      </header>

      {tab === 'agent' && (
        <div className="grid three">
          <section className="left">
            <h2>Scenes</h2>
            {SCENES.map((s, i) => (
              <button key={s.id} className={'scene' + (cur === s.id ? ' cur' : '')} disabled={busy} onClick={() => run(s.id)}><b>{i + 1}</b><span style={{flex:1}}>{s.title}</span><span style={{fontSize:20}}>{s.icon}</span></button>))}
            <h2>Or send your own brief</h2>
            <div className="row"><input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. beach holiday deals for US families" />
              <button disabled={busy || !brief} onClick={() => { setNote('Your brief went through the same resolver and policy check.'); resolve(brief); }}>Send</button></div>
            <h2>Buyer mandate</h2>
            <div className={'card ' + (mandate ? 'ok' : '')}>
              <div>Buyer: <b>Acme Media</b> · cap <b>$50,000</b> · categories <b>sporting_goods</b> · until <b>31 Dec 2026</b></div>
              <div className="muted">{mandate ? 'Signed by the buyer ✓' : 'Not signed yet. The agent cannot spend.'}</div>
              {!mandate && <button onClick={signMandate}>Buyer approves and signs</button>}
            </div>
            <h2>Privacy budget (Acme Media)</h2>
            <div className="meter"><div style={{ width: `${Math.round((budget.left ?? 0) * 100)}%` }} /></div>
            <div className="muted">{Math.round((budget.left ?? 0) * 100)}% of today’s questions left</div>
            <div className="row"><button onClick={() => { setBudget({ token: null, left: 1 }); setOptions([]); setMandate(null); setTrace([]); setFlow({}); setCur(null); setNote('Demo reset. Pick a scene to start again.'); }}>Reset demo</button></div>
          </section>
          <section className="right">
            <div className="note">{note}</div>
            {options.length > 0 && (<>
              <h2>Options returned to the agent</h2>
              <div className="opts">{options.map((o) => (
                <div className="card" key={o.quote.id}>
                  <b>{o.label}</b>
                  <div className="muted">{o.why[0]}</div>
                  <div style={{display:'flex',gap:18,margin:'6px 0'}}><div><div style={{fontSize:24,fontWeight:800,letterSpacing:-1}}>{Math.round((o.quote.daily_requests.p10+o.quote.daily_requests.p90)/2000)}k</div><div className="muted">requests/day</div></div><div><div style={{fontSize:24,fontWeight:800,letterSpacing:-1,color:'var(--acc)'}}>${o.quote.avg_cpm_usd}</div><div className="muted">CPM</div></div><div><div style={{fontSize:24,fontWeight:800,letterSpacing:-1}}>{Math.round(o.quote.safari_share * 100)}%</div><div className="muted">Safari</div></div></div>
                  <button disabled={busy} onClick={() => buy(o, mandate)}>Agent buys this</button>
                </div>))}</div></>)}
            <h2>What just happened <span style={{textTransform:'none',letterSpacing:0,fontWeight:400}}>(click a row for the raw request)</span></h2>
            {trace.length === 0 && <div className="muted">Nothing yet.</div>}
            {trace.map((t, i) => (
              <details key={i} className={'trace s' + String(t.status)[0]}>
                <summary><span className="st">{t.status}</span> <b style={{fontFamily:'inherit',fontSize:14}}>{plain(t)}</b> <span className="muted">· {t.label}</span></summary>
                {t.req && <pre>{JSON.stringify(t.req, (k, v) => (k === 'token' || k === 'budget_token' || k === 'quote_token' ? v && v.slice(0, 18) + '…' : v), 2)}</pre>}
                <pre>{JSON.stringify(t.res, (k, v) => (k === 'token' || k === 'budget_token' || k === 'registry_sig' ? v && v.slice(0, 18) + '…' : v), 2)}</pre>
              </details>))}
          </section>
          <aside className="flow">
            <h2>How the API decides</h2>
            {NODES.map(([k, t, d], i) => (<div key={k}><div className={'fnode ' + (flow[k] || 'idle')}><b>{t}</b><span>{d}</span></div>{i < NODES.length - 1 && <div className="farrow">▼</div>}</div>))}
          </aside>
        </div>
      )}

      {tab === 'desk' && <DealDesk call={call} />}

      {tab === 'policy' && (
        <div className="grid">
          <section className="left">
            <h2>Policy (Cedar)</h2>
            <p className="muted">These rules decide what any caller may target. Edit them, then run the proof before anything ships.</p>
            <div className="row"><button onClick={() => { setPolicies(LIVE_POLICIES); setProof(null); }}>Load live rules</button>
              <button onClick={() => { setPolicies(RISKY_POLICIES); setProof(null); }}>Load a risky edit</button></div>
            <textarea value={policies} onChange={(e) => setPolicies(e.target.value)} rows={18} />
            <button onClick={() => runProof()}>Run proof</button>
          </section>
          <section className="right">
            {!proof && <div className="note">Run the proof to check the property: no caller can target a sensitive or child-directed signal.</div>}
            {proof && (<div className={'card big ' + (proof.proved ? 'ok' : 'bad')}>
              <h2>{proof.proved ? 'Proved safe' : 'Unsafe: change blocked'}</h2>
              <div>{proof.property}</div>
              <div className="muted">{proof.cases_checked} cases checked. {proof.method}</div>
              {proof.counterexamples.length > 0 && (<><h3>Counterexamples</h3>
                <table><thead><tr><th>Principal</th><th>Action</th><th>Signal</th><th>Class</th></tr></thead>
                  <tbody>{proof.counterexamples.map((c, i) => (<tr key={i}><td>{c.principal}</td><td>{c.action}</td><td>{c.signal}</td><td>{c.class}</td></tr>))}</tbody></table></>)}
              {proof.over_blocked_open_signals?.length > 0 && <div className="muted">Also over-blocks: {proof.over_blocked_open_signals.join(', ')}</div>}
            </div>)}
          </section>
        </div>
      )}

      {tab === 'audit' && (
        <div className="grid">
          <section className="left">
            <h2>Audit log</h2>
            <p className="muted">Every brief, quote, commit and segment version leaves a receipt. The Merkle root changes if any entry changes.</p>
            <div className="row"><button onClick={verifyLog} disabled={!audit.length}>Verify log</button><button onClick={tamper} disabled={!audit.length}>Tamper with entry 1</button></div>
            {verify && (<div className={'card ' + (verify.ok ? 'ok' : 'bad')}>
              <b>{verify.ok ? 'Log verified: nothing was edited' : `Tampering detected in entry ${verify.bad.map((b) => b + 1).join(', ')}`}</b>
              <div className="muted mono">published root {verify.published?.slice(0, 16)}…</div>
              <div className="muted mono">recomputed root {verify.root?.slice(0, 16)}…</div></div>)}
            {roots.length > 0 && <div className="muted mono">Current root: {roots[roots.length - 1].slice(0, 24)}…</div>}
          </section>
          <section className="right">
            {!audit.length && <div className="note">No receipts yet. Run a scene in the Agent console first.</div>}
            {audit.map((e, i) => (<div className="card" key={i}><b>{i + 1}. {e.type}</b> <span className="muted">{e.at}</span>
              <pre>{JSON.stringify(e.summary, null, 1)}</pre><div className="muted mono">leaf {e.hash.slice(0, 20)}…</div></div>))}
          </section>
        </div>
      )}

      {tab === 'api' && (
        <section className="api">
          <h2>Call the API yourself</h2>
          <p>Base URL: this site. Unsigned calls from a terminal show the identity check working; signed agent calls need the demo agent key (see the README).</p>
          <pre>{`curl -s ${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/signals

curl -s -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/briefs:resolve \\
  -H 'content-type: application/json' -d '{"brief":"UK runners for a trail-shoe launch"}'
# -> 401 UNSIGNED_REQUEST: agents must sign every request

curl -s -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/segments:validate \\
  -H 'content-type: application/json' -H 'x-demo-user: deal-desk' \\
  -d '{"definition":{"all":[{"signal":"context.topic","op":"in","values":["health-pregnancy"]}]}}'
# -> valid: false, POLICY_SENSITIVE_SIGNAL`}</pre>
          <h3>Endpoints</h3>
          <ul>
            <li><code>GET /api/v1/signals</code> catalog of targetable signals</li>
            <li><code>POST /api/v1/briefs:resolve</code> brief to 3 quoted segments (signed agents)</li>
            <li><code>POST /api/v1/segments:validate</code>, <code>:estimate</code> check and size a segment</li>
            <li><code>POST /api/v1/segments</code>, <code>PATCH /api/v1/segments/{'{id}'}</code> create and version (deal desk)</li>
            <li><code>POST /api/v1/quotes/{'{id}'}:commit</code> buy under a signed mandate (signed agents)</li>
            <li><code>GET /api/v1/policies</code>, <code>POST /api/v1/policies:prove</code> live rules and the proof check</li>
          </ul>
        </section>
      )}
      <footer>Synthetic data only. Demo keys are public by design; in production every agent and buyer holds its own private key.</footer>
    </main>
  );
}

function DealDesk({ call }) {
  const [topic, setTopic] = useState('trail-running');
  const [intents, setIntents] = useState(['compare', 'buy']);
  const [geos, setGeos] = useState(['GB']);
  const [mobileOnly, setMobileOnly] = useState(false);
  const [est, setEst] = useState(null);
  const [versions, setVersions] = useState([]);
  const [msg, setMsg] = useState('Build a segment the way a deal desk would. The same API serves people and agents.');
  const def = () => ({ all: [
    { signal: 'context.topic', op: 'in', values: [topic], min_score: 0.7 },
    ...(intents.length ? [{ signal: 'context.intent_stage', op: 'in', values: intents }] : []),
    ...(geos.length ? [{ signal: 'geo.country', op: 'in', values: geos }] : []),
    ...(mobileOnly ? [{ signal: 'device.type', op: 'in', values: ['mobile'] }] : []),
  ] });
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  async function estimate() {
    const { status, data } = await call('POST', '/api/v1/segments:estimate', { definition: def() }, { signed: false, desk: true, label: 'Deal desk estimate' });
    setEst(status === 200 ? data : { error: data.error });
  }
  async function save() {
    const last = versions[versions.length - 1];
    const r = last
      ? await call('PATCH', `/api/v1/segments/${last.id}`, { segment_token: last.segment_token, definition: def() }, { signed: false, desk: true, label: 'Deal desk saves a new version' })
      : await call('POST', '/api/v1/segments', { name: 'Trail runners, UK', definition: def() }, { signed: false, desk: true, label: 'Deal desk creates a segment' });
    if (r.status < 300) { setVersions((v) => [...v, r.data]); setMsg(last ? `Saved as version ${r.data.version}. The live deal stays on version 1, so nothing changes under the buyer.` : 'Saved as version 1 and attached to deal mn-desk-01.'); }
    else setMsg(r.data.error.detail);
  }
  return (
    <div className="grid">
      <section className="left">
        <h2>Build a segment</h2>
        <label>Topic<select value={topic} onChange={(e) => setTopic(e.target.value)}>{Object.entries(TOPICS).map(([k, t]) => <option key={k} value={k}>{t.label}{t.cls !== 'open' ? ` (${t.cls})` : ''}</option>)}</select></label>
        <div className="chips">Intent {INTENTS.map((i) => <button key={i} className={intents.includes(i) ? 'on' : ''} onClick={() => toggle(intents, setIntents, i)}>{i}</button>)}</div>
        <div className="chips">Country {GEOS.map((g) => <button key={g} className={geos.includes(g) ? 'on' : ''} onClick={() => toggle(geos, setGeos, g)}>{g}</button>)}</div>
        <label className="check"><input type="checkbox" checked={mobileOnly} onChange={(e) => setMobileOnly(e.target.checked)} /> Mobile only</label>
        <div className="row"><button onClick={estimate}>Validate and estimate</button><button onClick={save}>{versions.length ? 'Save as new version' : 'Save version 1'}</button></div>
        <pre>{JSON.stringify(def(), null, 1)}</pre>
      </section>
      <section className="right">
        <div className="note">{msg}</div>
        {est && !est.error && (<div className="card">{est.below_floor ? <b>Below floor: too small to show</b> : <>
          <b>Daily requests {est.daily_requests.p10.toLocaleString()}–{est.daily_requests.p90.toLocaleString()}</b>
          <div>CPM ${est.avg_cpm_usd} · Safari share {Math.round(est.safari_share * 100)}%</div></>}
          <div className="muted">{est.method}</div></div>)}
        {est?.error && (<div className="card bad"><b>{est.error.code}</b><div>{est.error.detail}</div>
          {est.error.errors?.map((e, i) => <div key={i} className="muted">{e.path}: {e.detail}</div>)}</div>)}
        {versions.length > 0 && (<><h2>Versions</h2>{versions.map((v) => (
          <div className="card" key={v.version}><b>{v.id} · version {v.version}</b> {v.version === 1 && <span className="pill">deal mn-desk-01 pinned here</span>}
            <div className="muted mono">hash {v.hash}</div></div>))}</>)}
      </section>
    </div>
  );
}
