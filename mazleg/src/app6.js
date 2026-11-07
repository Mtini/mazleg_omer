// ---------- actions ----------
const A = {
  noop() {},
  go(el) { const to = el.dataset.to; if (to === 'home') go('home'); else if (to === 'family') go('family'); },
  lang() { S.lang = S.lang === 'he' ? 'en' : 'he'; S.store.settings.lang = S.lang; persist(); S.linkCache = {}; if (S.route.name === 'event') openEvent(S.route.id); else render(); },
  newDinner() { S.draft = newDraft(); go('wizard'); S.ui.focus = '#ev-name'; render(); },
  openEvent(el) { openEvent(el.dataset.id); },
  openSeatingOf(el) { go('seating', { id: el.dataset.id }); },
  modal(el) { S.modal = { kind: el.dataset.kind, picked: [] }; render(); if (el.dataset.kind === 'paste') { const ta = document.getElementById('paste-ta'); ta && ta.focus(); } },
  modalClose() { S.modal = null; render(); },
  scrim(el, e) { if (e.target === el) { S.modal = null; render(); } },
  confirmOk() { const f = S.modal.onOk; S.modal = null; f && f(); render(); },
  copy(el) { if (el.dataset.v) copyText(el.dataset.v); },
  share(el) { if (el.dataset.url) nativeShare(el.dataset.title, el.dataset.text, el.dataset.url); },
  selectAll(el) { el.select && el.select(); },
  // wizard
  wzGo(el) { const s = +el.dataset.step; const d = S.draft; if (s > d.step) { for (let i = d.step; i < s; i++) if (!validateStep(i)) { d.step = i; render(); return; } } if (s >= 2) ensureLayout(); d.step = s; S.ui.sel = null; render(); window.scrollTo(0, 0); },
  wzNext() { const d = S.draft; if (!validateStep(d.step)) { render(); return; } d.step++; if (d.step === 2) { ensureLayout(); if (d.layoutMode !== 'custom' && activeSeats(d.layout) < d.participants.length) { d.cfg = fitCfg(d.layoutMode, d.cfg, d.participants.length); rebuildFromCfg(); } } render(); window.scrollTo(0, 0); },
  wzBack() { S.draft.step--; S.draft.errors = {}; render(); window.scrollTo(0, 0); },
  wzCancel() { const ed = S.draft && S.draft.editing; S.draft = null; if (ed) openEvent(ed); else go('home'); },
  wzFinish() { finishWizard(); },
  dType(el) { S.draft.type = el.dataset.v; render(); },
  qaAdd() { const n = document.getElementById('qa-name'), a = document.getElementById('qa-age'); if (addPerson(n.value, a.value)) { S.draft.errors = {}; S.ui.focus = '#qa-name'; render(); } else n.focus(); },
  pRemove(el) { S.draft.participants = S.draft.participants.filter((p) => p.id !== el.dataset.id); render(); },
  pasteAdd() { const v = document.getElementById('paste-ta').value; v.split(/\r?\n/).forEach((line) => { const m = line.split(/[,\t;]/); addPerson(m[0], m[1] && m[1].trim()); }); S.modal = null; render(); },
  famPick(el) { const id = el.dataset.id, p = S.modal.picked; const i = p.indexOf(id); i >= 0 ? p.splice(i, 1) : p.push(id); render(); },
  famPickAll() { const have = new Set(S.draft.participants.map((p) => p.familyId)); S.modal.picked = S.store.family.filter((m) => !have.has(m.id)).map((m) => m.id); render(); },
  famImportGo() { for (const id of S.modal.picked) { const m = S.store.family.find((x) => x.id === id); if (m) addPerson(m.name, m.age, { photo: m.photo || null, familyId: m.id }); } S.modal = null; render(); },
  photo(el) { S.ui.photoTarget = { scope: el.dataset.scope, id: el.dataset.id }; document.getElementById('file').click(); },
  layoutMode(el) { const d = S.draft; d.layoutMode = el.dataset.v; if (d.layoutMode !== 'custom') { d.cfg = fitCfg(d.layoutMode, Object.assign(suggestCfg(d.participants.length), { orient: d.cfg.orient }), d.participants.length); rebuildFromCfg(); } render(); },
  cfg(el) { const c = S.draft.cfg, k = el.dataset.k; const lim = { tables: [1, 20], perSide: [1, 20], seats: [2, 24], count: [1, 20], seatsEach: [2, 16] }[k]; c[k] = Math.max(lim[0], Math.min(lim[1], c[k] + +el.dataset.d)); rebuildFromCfg(); render(); },
  cfgToggle(el) { const c = S.draft.cfg; c[el.dataset.k] = !c[el.dataset.k]; rebuildFromCfg(); render(); },
  cfgSet(el) { S.draft.cfg[el.dataset.k] = el.dataset.v; rebuildFromCfg(); render(); },
  adjToggle() { S.ui.showAdj = !S.ui.showAdj; render(); },
  tAdd() { const L = S.draft.layout; const xs = L.chairs.map((c) => c.x), ys = L.chairs.map((c) => c.y); const x = (xs.length ? Math.max(...xs) : 0) + 200, y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0; const tb = E.rectTable(x, y, 2, 0); L.tables.push(tb); L.chairs.push(...E.rectChairs(tb, 2, [])); S.draft.layoutMode = 'custom'; S.ui.sel = { type: 'table', id: tb.id }; render(); },
  tRot() { const L = S.draft.layout; const tb = L.tables.find((x) => x.id === S.ui.sel.id); tb.rot = ((tb.rot || 0) + 90) % 360; L.chairs.filter((c) => c.tableId === tb.id).forEach((c) => { const p = rotAround(c.x, c.y, tb.x, tb.y, 90); c.x = p[0]; c.y = p[1]; }); S.draft.layoutMode = 'custom'; render(); },
  tSize(el) { const L = S.draft.layout; const tb = L.tables.find((x) => x.id === S.ui.sel.id); const info = tableInfo(L, tb); const d = +el.dataset.d;
    if (tb.shape === 'rect') { info.perSide = Math.max(1, Math.min(20, info.perSide + d)); rebuildTable(L, tb, { info }); } else rebuildTable(L, tb, { seats: Math.max(2, Math.min(24, info.seats + d)) });
    S.draft.layoutMode = 'custom'; render(); },
  tHead() { const L = S.draft.layout; const tb = L.tables.find((x) => x.id === S.ui.sel.id); const info = tableInfo(L, tb); info.ends = info.ends.length === 2 ? [] : info.ends.length === 1 ? [-1, 1] : [1]; rebuildTable(L, tb, { info }); S.draft.layoutMode = 'custom'; render(); },
  tDel() { const L = S.draft.layout; const id = S.ui.sel.id; L.tables = L.tables.filter((x) => x.id !== id); L.chairs = L.chairs.filter((c) => c.tableId !== id); S.ui.sel = null; S.draft.layoutMode = 'custom'; render(); },
  cAdd() { const L = S.draft.layout; const tb = L.tables.find((x) => x.id === S.ui.sel.id); const cs = L.chairs.filter((c) => c.tableId === tb.id);
    const cands = tb.shape === 'rect' ? [[tb.w / 2 + E.OFF, 0], [-tb.w / 2 - E.OFF, 0], [0, tb.h / 2 + E.OFF], [0, -tb.h / 2 - E.OFF], [tb.w / 2 + E.OFF, tb.h / 2 + E.OFF]] : [[tb.w / 2 + E.OFF + 20, 0], [0, tb.h / 2 + E.OFF + 20]];
    let pos = null; for (const [lx, ly] of cands) { const w = E.toWorld(tb, lx, ly); if (cs.every((c) => Math.hypot(c.x - w[0], c.y - w[1]) > 30)) { pos = w; break; } }
    if (!pos) pos = E.toWorld(tb, 0, tb.h / 2 + E.OFF * 2.6);
    const c = { id: 'c' + rid(7), tableId: tb.id, x: pos[0], y: pos[1] }; L.chairs.push(c); S.ui.sel = { type: 'chair', id: c.id }; S.draft.layoutMode = 'custom'; render(); },
  cToggle() { const c = S.draft.layout.chairs.find((x) => x.id === S.ui.sel.id); c.disabled = !c.disabled; S.draft.layoutMode = 'custom'; render(); },
  cDel() { const L = S.draft.layout; L.chairs = L.chairs.filter((c) => c.id !== S.ui.sel.id); S.ui.sel = null; S.draft.layoutMode = 'custom'; render(); },
  toggleSaveFam() { S.draft.saveFamily = !S.draft.saveFamily; render(); },
  // event
  editSetup() { const ev = evById(S.route.id); S.draft = newDraft(ev); go('wizard'); },
  delEvent() { const ev = evById(S.route.id); confirmBox(t('deleteEvent'), t('confirmDelete', { x: esc(ev.name) }), t('del'), () => { S.store.events = S.store.events.filter((x) => x.id !== ev.id); persist(); go('home'); }, true); },
  toggleVoting() { const ev = evById(S.route.id); ev.votingOpen = !ev.votingOpen; persist(); render(); },
  voteLocal() { startVoteLocal(evById(S.route.id)); },
  importReply() { const v = document.getElementById('reply-in').value.trim(); if (v) importReply(v, false); },
  generate() { generate(evById(S.route.id)); },
  openSeating() { go('seating', { id: S.route.id }); },
  ruleKind(el) { S.modal.rk = el.dataset.v; render(); },
  ruleAdd() { const a = document.getElementById('rule-a').value, b = document.getElementById('rule-b').value; if (!a || !b || a === b) { toast(t('pickTwo')); return; } const ev = evById(S.route.id); ev.rules = ev.rules || []; ev.rules.push({ kind: S.modal.rk === 'apart' ? 'apart' : 'together', a, b }); if (ev.plan) ev.plan.stale = true; persist(); S.modal = null; render(); },
  ruleDel(el) { const ev = evById(S.route.id); ev.rules.splice(+el.dataset.i, 1); persist(); render(); },
  // voting
  voteMe(el) { voteSelectMe(el.dataset.id); },
  votePick(el) { togglePick(el.dataset.id); },
  voteSubmit() { const V = S.vote; const names = V.draft.map((id) => (V.ev.participants.find((p) => p.id === id) || {}).name); confirmBox(t('confirmT'), `${t('youChose')} <b>${names.length ? esc(names.join(', ')) : t('noPref')}</b><br><span class="muted small">${t('confirmB')}</span>`, t('yesSubmit'), submitVote); },
  voteNotMe() { const V = S.vote; if (V.lockedMe) V.lockedMe = null; V.step = 'who'; V.me = null; V.draft = []; render(); },
  voteNext() { const V = S.vote; V.step = 'who'; V.me = null; V.draft = []; render(); window.scrollTo(0, 0); },
  voteEdit() { S.vote.step = 'pick'; render(); },
  voteExit() { const id = S.vote.full.id; S.vote = null; openEvent(id); },
  usePrev() { const V = S.vote; V.draft = V.prev.ids.slice(0, 2); V.prev = null; render(); },
  // seating
  lockSeat() { const ev = evById(S.route.id); const pl = ev.plan; pl.locked = pl.locked || []; const c = S.ui.chairSel; const i = pl.locked.indexOf(c); i >= 0 ? pl.locked.splice(i, 1) : pl.locked.push(c); persist(); render(); },
  pickOption(el) { const ev = evById(S.route.id); const pl = ev.plan; const i = +el.dataset.i; const doIt = () => { pl.active = i; pl.assignment = Object.assign({}, pl.options[i].assignment); pl.current = pl.options[i]; pl.manual = false; pl.dirty = true; pl.locked = []; persist(); render(); }; if (pl.manual) confirmBox(t('confirmSwitch'), '', t('options'), doIt); else doIt(); },
  savePlan() { const ev = evById(S.route.id); ev.plan.savedAt = Date.now(); ev.plan.dirty = false; persist(); toast(t('saved')); render(); },
  publish() { publish(evById(S.route.id)); },
  // chat
  chatOpen(el) { openChat(el.dataset.ctx); },
  chatSend() { chatSend(S.chat.input || (document.getElementById('chat-in') || {}).value); },
  chatSugg(el) { chatSend(el.dataset.v); },
  chatAction(el) {
    const m = S.chat.msgs[+el.dataset.m]; const a = m.actions[+el.dataset.a]; const V = S.vote; if (!V) return;
    for (const id of a.ids) { if (V.draft.includes(id) || id === V.me) continue; if (V.draft.length >= 2) { toast(t('maxTwo')); break; } V.draft.push(id); }
    m.actions.forEach((x) => { if (x.ids.every((id) => V.draft.includes(id))) x.done = true; }); render();
  },
  // family
  famAdd() { S.store.family.unshift({ id: rid(6), name: S.lang === 'he' ? 'בן משפחה חדש' : 'New family member', age: null, photo: null }); persist(); S.ui.focus = '[data-in="fName"]'; render(); },
  famDel(el) { const m = S.store.family.find((x) => x.id === el.dataset.id); confirmBox(t('del'), t('confirmDelMember', { x: esc(m.name) }), t('del'), () => { S.store.family = S.store.family.filter((x) => x.id !== m.id); persist(); }, true); },
};
const INPUTS = {
  dName(el) { S.draft.name = el.value; }, dCustom(el) { S.draft.customType = el.value; }, dDate(el) { S.draft.date = el.value; },
  dExpected(el) { S.draft.expected = Math.max(0, Math.min(200, parseInt(el.value, 10) || 0)); },
  pName(el) { const p = S.draft.participants.find((x) => x.id === el.dataset.id); if (p) p.name = el.value; },
  pAge(el) { const p = S.draft.participants.find((x) => x.id === el.dataset.id); if (p) p.age = el.value === '' ? null : Math.max(0, Math.min(120, parseInt(el.value, 10) || 0)); },
  pGroup(el) { const p = S.draft.participants.find((x) => x.id === el.dataset.id); if (p) p.group = el.value; },
  fName(el) { const m = S.store.family.find((x) => x.id === el.dataset.id); if (m) { m.name = el.value; persist(); } },
  fAge(el) { const m = S.store.family.find((x) => x.id === el.dataset.id); if (m) { m.age = el.value === '' ? null : parseInt(el.value, 10); persist(); } },
  baseUrl(el) { const v = el.value.trim(); S.store.settings.baseUrl = /^https?:\/\//.test(v) ? v.split('#')[0] : ''; persist(); clearTimeout(INPUTS._b); INPUTS._b = setTimeout(() => openEvent(S.route.id), 700); },
  chatText(el) { S.chat.input = el.value; },
  findMe(el) { S.ui.findMe = el.value || null; render(); },
  swapWith(el) { if (!el.value) return; const ev = evById(S.route.id); const to = ev.plan.assignment[el.value]; moveSeat(ev, S.ui.chairSel, to); },
};
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT') { if (el && el.dataset.act === 'selectAll') A.selectAll(el); return; } const f = A[el.dataset.act]; if (f) { if (el.tagName !== 'A') e.preventDefault(); f(el, e); } });
document.addEventListener('input', (e) => { const el = e.target.closest('[data-in]'); if (el && INPUTS[el.dataset.in] && el.tagName !== 'SELECT') INPUTS[el.dataset.in](el, e);
  const fl = e.target.closest('[data-filter]'); if (fl) { const q = fl.value.trim().toLowerCase(); document.querySelectorAll('#' + fl.dataset.filter + ' [data-name]').forEach((c) => { c.style.display = !q || c.dataset.name.includes(q) ? '' : 'none'; }); } });
document.addEventListener('change', (e) => { const el = e.target.closest('select[data-in],input[type="date"][data-in]'); if (el && INPUTS[el.dataset.in]) INPUTS[el.dataset.in](el, e); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.id === 'qa-name' || e.target.id === 'qa-age')) { e.preventDefault(); A.qaAdd(); }
  else if (e.key === 'Enter' && e.target.id === 'chat-in') { e.preventDefault(); A.chatSend(); }
  else if (e.key === 'Escape' && S.present) { S.present = null; render(); }
  else if (e.key === 'Escape' && S.modal) { S.modal = null; render(); }
  else if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'switch') { e.preventDefault(); e.target.click(); }
});
document.getElementById('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; const tg = S.ui.photoTarget; if (!f || !tg) return;
  try { const url = await resizePhoto(f); const list = tg.scope === 'family' ? S.store.family : S.draft.participants; const it = list.find((x) => x.id === tg.id); if (it) it.photo = url; if (tg.scope === 'family') persist(); render(); } catch (err) { toast('—'); }
});
window.addEventListener('storage', (e) => { if (e.key !== KEY || S.demo || SERVER) return; S.store = loadStore(); if (['event', 'home', 'family'].includes(S.route.name)) render(); });
let _rw = innerWidth; window.addEventListener('resize', () => { if ((innerWidth < 700) !== (_rw < 700)) { _rw = innerWidth; render(); } });

// ---------- incoming links ----------
async function handleHash() {
  const h = location.hash.slice(1); const m = h.match(/^([ivs])-([0-9a-z]+)$/); if (!m) return false;
  let data; try { data = await unpack(m[2]); } catch (e) { S.route = { name: 'home' }; render(); toast(t('linkBroken')); return true; }
  if (data.l && !S.store.settings.lang) S.lang = data.l;
  if (m[1] === 'i') {
    const ev = { id: data.e, key: data.k, name: data.n, date: data.d, participants: data.p.map(([id, name]) => ({ id, name })) };
    const own = evById(data.e);
    if (own) { const live = own; S.vote = { mode: 'local', full: live, ev: { id: live.id, name: live.name, date: live.date, participants: live.participants }, step: 'who', me: null, draft: [] }; }
    else S.vote = { mode: 'remote', ev, step: 'who', me: null, draft: [], tk: data.tk, lockedMe: data.me };
    S.route = { name: 'vote' }; render();
    const mine = S.store.myVotes[data.e];
    if (data.me && ev.participants.some((p) => p.id === data.me)) voteSelectMe(data.me);
    else if (mine && S.vote.mode === 'remote') { voteSelectMe(mine.me); }
    return true;
  }
  if (m[1] === 'v') { await importReply('v-' + m[2], true); return true; }
  if (m[1] === 's') { S.remote = decodeResult(data); S.route = { name: 'result' }; render(); return true; }
  return false;
}
window.addEventListener('hashchange', handleHash);

