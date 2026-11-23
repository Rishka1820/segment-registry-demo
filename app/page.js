'use client';
import { useState, useEffect, useRef } from 'react';

const STEPS = [
  { k: 'THE PROBLEM', h: 'AI agents are about to buy media.', t: 'The API behind targeting segments was built for careful humans. Agents are fast, sometimes wrong, and they spend someone else’s money. Watch what changes.', acts: [] },
  { k: 'WHO IS CALLING?', h: 'No signature, no entry.', t: 'An unknown agent sends a request with no signature. The API rejects it before reading a word.', acts: [{ scene: 0 }], look: 'Red: check 1 fails' },
  { k: 'THE BRIEF', h: 'Plain English in. Priced options out.', t: 'A signed agent asks for “UK runners for a trail-shoe launch”. It gets three real segments, each with reach, price and a 15-minute quote.', acts: [{ scene: 1 }], look: 'Three option cards, checks 1 to 3 go green' },
  { k: 'SENSITIVE TOPICS', h: 'Caught by meaning, not keywords.', t: '“Expecting parents, first trimester” never says pregnant. The meaning check still refuses it and offers a safe alternative.', acts: [{ scene: 2 }], look: 'Blocked: health-pregnancy' },
  { k: 'THE BUYER’S MONEY', h: 'No signature, no spend.', t: 'The agent tries to buy on its own. Nobody spends without the buyer’s signed mandate: cap, category and expiry.', acts: [{ scene: 3 }], look: '403 on the buy attempt' },
  { k: 'TWO SIGNATURES', h: 'Buyer and publisher both agree.', t: 'The buyer signs. The deal goes live, and two publishers who refuse these ads are left out automatically.', acts: [{ scene: 4 }], look: 'Checks 5 and 6 go green' },
  { k: 'PRIVACY', h: 'Questions run out before people are exposed.', t: 'An agent narrows a segment step by step to find individuals. It only ever sees “below floor”, then its question budget runs out.', acts: [{ scene: 5 }], look: 'Budget meter drops to zero' },
  { k: 'THE RULES THEMSELVES', h: 'Unsafe edits are proven wrong first.', t: 'Someone loosens the policy to allow health targeting. The proof fails and lists exactly which cases break.', acts: [{ scene: 6 }], look: 'Counterexample table' },
  { k: 'THE RECEIPTS', h: 'Edit one word and the seal breaks.', t: 'Every call leaves a receipt. Change a single entry and the log’s seal no longer matches, so tampering is visible.', acts: [{ scene: 7 }, { btn: 'Tamper with entry 1' }, { btn: 'Verify log' }], pre: [1], look: '“Tampering detected”' },
  { k: 'MEASURING SUCCESS', h: 'Zero violations, then growth.', t: 'North star: weekly spend on agent-booked deals with zero mandate violations.', acts: [], table: [['Time to live deal', 'Under 5 minutes'], ['Reach in quoted range', '80% of the time'], ['Policy recall', '99% on red-team set'], ['Sandbox to live', '50% in 30 days']] },
];
const W = 1500, H = 860;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Tour() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [scale, setScale] = useState(0.5);
  const [cur, setCur] = useState({ x: 40, y: 40, show: false, click: 0 });
  const box = useRef(null), frame = useRef(null), run = useRef(0);
  const [ver, setVer] = useState(0);

  useEffect(() => {
    const f = () => box.current && setScale(box.current.clientWidth / W);
    f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f);
  }, []);

  function doc() { return frame.current && frame.current.contentDocument; }
  function find(a) {
    const d = doc(); if (!d) return null;
    if (a.scene !== undefined) return d.querySelectorAll('.scene')[a.scene];
    return [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === a.btn && !b.disabled);
  }
  async function waitFor(a, tries = 40) { for (let n = 0; n < tries; n++) { const e = find(a); if (e) return e; await sleep(150); } return null; }

  async function play(n, token) {
    const s = STEPS[n];
    await sleep(900);
    for (const p of s.pre || []) { const e = await waitFor({ scene: p }); if (e) e.click(); await sleep(1500); if (run.current !== token) return; }
    for (const a of s.acts) {
      const e = await waitFor(a); if (!e || run.current !== token) return;
      const r = e.getBoundingClientRect();
      setCur({ x: (r.left + Math.min(r.width / 2, 120)) * scale, y: (r.top + r.height / 2) * scale, show: true, click: 0 });
      await sleep(1000); if (run.current !== token) return;
      setCur((c) => ({ ...c, click: c.click + 1 })); await sleep(250);
      e.click(); await sleep(a.scene === 5 ? 6000 : 2600);
    }
    setCur((c) => ({ ...c, show: false }));
    if (auto && run.current === token) { await sleep(3500); if (run.current === token && n < STEPS.length - 1) setI(n + 1); }
  }
  useEffect(() => { setVer((v) => v + 1); }, [i]);
  function onLoad() { const token = ++run.current; setCur((c) => ({ ...c, show: false })); play(i, token); }
  useEffect(() => { if (!auto) run.current++; }, [auto]);

  const s = STEPS[i];
  return (
    <main style={{ maxWidth: 1480, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="brand">media<i>.</i>net</div>
          <div className="kick" style={{ color: 'var(--ink)' }}>SEGMENT REGISTRY <span style={{ color: 'var(--muted)' }}>|</span> RISHIKA SRIVASTAVA</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><a href="/console" className="solid">Try a targeting brief</a><div className="kick" style={{ color: 'var(--muted)' }}>Guided tour {i + 1} / {STEPS.length}</div></div>
      </header>
      <div className="tour">
        <div className="shot">
          <div className="bar"><i style={{ background: '#ff5f57' }} /><i style={{ background: '#febc2e' }} /><i style={{ background: '#28c840' }} /><span>segment-registry-demo.vercel.app · Agent Console</span></div>
          <div ref={box} className="screen" style={{ height: H * scale }}>
            <iframe key={ver} ref={frame} src="/console?embed=1" onLoad={onLoad} title="Live prototype" style={{ width: W, height: H, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
            <div className={'cursor' + (cur.show ? ' on' : '')} style={{ left: cur.x, top: cur.y }}>
              <svg width="26" height="26" viewBox="0 0 24 24"><path d="M3 2l7 18 2.6-7.4L20 10z" fill="#111" stroke="#fff" strokeWidth="1.5" /></svg>
              {cur.click > 0 && <span key={cur.click} className="ripple" />}
            </div>
          </div>
        </div>
        <div className="side">
          <div className="kick" style={{ color: 'var(--acc)' }}>{s.k}</div>
          <h1 className="big">{s.h}</h1>
          <p className="lead">{s.t}</p>
          {s.look && <div className="look"><b>Look for</b> {s.look}</div>}
          {s.table && (<div className="tbl">{s.table.map(([a, b]) => (<div key={a}><b>{a}</b><span>{b}</span></div>))}</div>)}
        </div>
      </div>
      <div className="foot">
        <div className="dots">{STEPS.map((_, n) => (<button key={n} aria-label={'Step ' + (n + 1)} onClick={() => setI(n)} className={n === i ? 'cur' : n < i ? 'done' : ''} />))}</div>
        <a href="/console" className="skip">Skip to prototype</a>
        <button className="ghost" onClick={() => setAuto(!auto)}>{auto ? 'Pause autoplay' : 'Autoplay'}</button>
        <button className="ghost" onClick={() => setVer((v) => v + 1)}>Replay step</button>
        <button className="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
        {i < STEPS.length - 1 ? <button className="solid" onClick={() => setI(i + 1)}>Next →</button> : <a className="solid" href="/console">Try it yourself →</a>}
      </div>
    </main>
  );
}
