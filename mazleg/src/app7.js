// ---------- 3D integration ----------
const THREE_SRC = ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'];
let threeState = window.THREE && window.THREE.OrbitControls ? 'ready' : 'idle', V3 = null;
function loadThree() {
  if (threeState !== 'idle') return; threeState = 'loading';
  const one = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  one(THREE_SRC[0]).then(() => one(THREE_SRC[1])).then(() => { threeState = window.THREE && window.THREE.OrbitControls ? 'ready' : 'failed'; render(); })
    .catch(() => { threeState = 'failed'; render(); });
}
function viewer3d() {
  if (V3) return V3;
  try { V3 = new Mazleg3D.Viewer({ initials, hiddenText: (n) => t('v3hidden', { n }), onPick: (id) => S.ui.onPick3d && S.ui.onPick3d(id) }); }
  catch (e) { threeState = 'failed'; V3 = null; }
  return V3;
}
const is3d = (ctx) => S.ui.m3 ? S.ui.m3[ctx] : false;
function modeSeg(ctx) {
  return `<div class="seg" role="group" aria-label="2D / 3D"><button data-act="mode3d" data-ctx="${ctx}" data-v="0" aria-pressed="${!is3d(ctx)}">${t('v2d')}</button><button data-act="mode3d" data-ctx="${ctx}" data-v="1" aria-pressed="${is3d(ctx)}">${ic('box')} ${t('v3d')}</button></div>`;
}
/** A 3D block. The data passed here is the live state — the same layout, chair ids and assignment the 2D plan and engine use. */
function view3d(id, data, opts) {
  S.ui.v3pending = { id, data, onPick: opts && opts.onPick };
  if (threeState === 'idle') loadThree();
  const msg = threeState === 'failed' ? `<div class="v3d-msg">${ic('info')}<p>${t('v3fail')}</p></div>` : threeState !== 'ready' ? `<div class="v3d-msg"><img src="${LOGO}" alt="" class="bobbing"><p class="muted">${t('v3loading')}</p></div>` : '';
  const bar = threeState === 'ready' ? `<div class="v3d-bar">
      <button class="btn sm" data-act="v3view" data-v="iso" aria-pressed="${(V3 && V3.view || 'iso') === 'iso'}">${t('vIso')}</button>
      <button class="btn sm" data-act="v3view" data-v="top" aria-pressed="${V3 && V3.view === 'top'}">${t('vTop')}</button>
      <button class="btn sm" data-act="v3view" data-v="eye" aria-pressed="${V3 && V3.view === 'eye'}">${t('vEye')}</button>
      <button class="btn sm" data-act="v3detail" aria-pressed="${S.ui.detail !== false}">${S.ui.detail !== false ? t('vDetailed') : t('vClean')}</button></div>
      <p class="v3d-hint tiny">${t('v3hint')}</p>` : '';
  return `<div class="v3d-wrap ${opts && opts.tall ? 'tall' : ''}"><div class="v3d" id="${id}"></div>${bar}${msg}</div>`;
}
function mount3d() {
  const p = S.ui.v3pending; S.ui.v3pending = null;
  if (!p || threeState !== 'ready') return;
  const el = document.getElementById(p.id); if (!el) return;
  const v = viewer3d(); if (!v) { render(); return; }
  S.ui.onPick3d = p.onPick || null;
  v.attach(el); v.setData(Object.assign({ detail: S.ui.detail !== false }, p.data));
  if (p.data.intro && !p.data.introDone) { p.data.introDone = true; p.data.intro(v); }
}
function neighborChairs(layout, chairId) {
  if (!chairId) return []; const { adj } = E.computeAdjacency(layout); return adj.has(chairId) ? [...adj.get(chairId)] : [];
}
function sidesText(ev, assign, pid) {
  const s = Mazleg3D.sides(ev.layout, assign, pid); const nm = (id) => esc((ev.participants.find((p) => p.id === id) || {}).name || '');
  const parts = [`${t('leftOf')}: <b>${s.left ? nm(s.left) : t('nobody')}</b>`, `${t('rightOf')}: <b>${s.right ? nm(s.right) : t('nobody')}</b>`];
  if (s.also.length) parts.push(`${t('alsoBeside')}: ${s.also.map(nm).join(', ')}`);
  if (s.across.length) parts.push(`${t('acrossFrom')}: ${s.across.map(nm).join(', ')}`);
  return parts.join(' · ');
}

// ---------- presentation (on publish, or replay) ----------
function presentOverlay() {
  const P = S.present; if (!P) return '';
  const ev = P.remote ? P.remote.ev : evById(P.evId); if (!ev) return '';
  const assign = P.remote ? P.remote.assign : ev.plan.assignment;
  const finish = () => { if (P.done || S.present !== P) return; P.done = true; confettiBurst(); render(); };
  if (!P.safety) P.safety = setTimeout(finish, 9000);   // the card always appears, even if 3D stalls
  const data = { key: 'present-' + (ev.id || ev.name), layout: ev.layout, assign, people: ev.participants, detail: true, highlight: [], intro: (v) => { P.started = true; v.intro(finish); }, introDone: !!P.started };
  let stage;
  if (threeState === 'failed') { P.done = true; stage = `<div class="plan-wrap" style="margin:auto;max-width:960px;width:100%">${planSVG({ layout: ev.layout, mode: 'view', assign, people: ev.participants, rot: shouldRotate(ev.layout) }, 'presentplan')}</div>`; }
  else stage = view3d('v3d-present', data, { tall: true });
  const url = P.url;
  return `<div class="present" role="dialog" aria-modal="true" aria-label="${esc(ev.name)}">
    <div class="present-top"><img src="${LOGO}" alt="MAZLEG"><div style="flex:1;min-width:0"><b>${esc(ev.name)}</b><div class="tiny muted">${esc(fmtDate(ev.date) || '')}</div></div><button class="btn icon" data-act="presentClose" aria-label="${t('close')}">${ic('x')}</button></div>
    <div class="present-stage">${stage}</div>
    ${P.done ? `<div class="present-card"><img src="${LOGO}" alt="" class="pop"><div><h3>${t('ready')}</h3><p class="small muted">${t('presentSub', { n: ev.participants.length })}</p></div>
      ${url ? `<div class="row" style="justify-content:center"><a class="btn gold" href="${esc(waHref(t('waResult', { x: ev.name }) + '\n' + url))}" target="_blank" rel="noopener">${ic('msg')} ${t('whatsapp')}</a><button class="btn" data-act="copy" data-v="${esc(url)}">${ic('copy')} ${t('copy')}</button><button class="btn" data-act="share" data-title="${esc(ev.name)}" data-text="${esc(t('waResult', { x: ev.name }))}" data-url="${esc(url)}">${ic('share')}</button></div>` : ''}</div>` : ''}
  </div>`;
}
function confettiBurst() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div'); el.className = 'confetti-layer';
  let h = ''; for (let i = 0; i < 54; i++) { const c = ['#C5A352', '#1A1918', '#E8D9B0', '#ffffff'][i % 4]; h += `<i class="conf" style="left:${Math.random() * 100}%;background:${c};animation-duration:${1.8 + Math.random() * 1.6}s;animation-delay:${Math.random() * .4}s;${c === '#ffffff' ? 'border:1px solid #ddd;' : ''}"></i>`; }
  el.innerHTML = h; document.body.appendChild(el); setTimeout(() => el.remove(), 4000);
}

Object.assign(A, {
  mode3d(el) { S.ui.m3 = S.ui.m3 || {}; S.ui.m3[el.dataset.ctx] = el.dataset.v === '1'; render(); },
  v3view(el) { if (V3) { V3.setView(el.dataset.v, true); render(); } },
  v3detail() { S.ui.detail = S.ui.detail === false; render(); },
  present() { const ev = evById(S.route.id); S.present = { evId: ev.id, url: ev.plan.resultUrl || null }; render(); },
  presentClose() { S.present = null; render(); },
});
Object.assign(INPUTS, {
  seatFind(el) { const ev = evById(S.route.id); S.ui.chairSel = el.value ? ev.plan.assignment[el.value] : null; render(); },
});
