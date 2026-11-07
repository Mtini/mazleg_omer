// ---------- render ----------
const VIEWS = { home: () => viewHome(), wizard: () => viewWizard(), event: () => viewEvent(), vote: () => viewVote(), seating: () => viewSeating(), result: () => viewResult(), family: () => viewFamily() };
function render() {
  document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === 'he' ? 'rtl' : 'ltr';
  const r = S.route.name;
  const body = S.ui.busy ? `<div class="loader"><img src="${LOGO}" alt=""><p class="muted">${t('generating')}</p></div>` : (VIEWS[r] || VIEWS.home)();
  const chatScroll = document.getElementById('chat-scroll');
  app.innerHTML = header() + `<main id="main">${body}</main>` + viewModal() + presentOverlay();
  document.body.style.overflow = S.present ? 'hidden' : '';
  if (S.route.name === 'wizard' && S.draft && S.draft.step === 2) bindDesigner();
  if (r === 'seating') { const ev = evById(S.route.id); if (ev && ev.plan) bindSeating(ev, 'seatplan', true); }
  if (r === 'result') bindSeating({ layout: S.remote.ev.layout, plan: { assignment: S.remote.assign, locked: [] }, participants: S.remote.ev.participants }, 'resultplan', false);
  mount3d();
  const cs = document.getElementById('chat-scroll'); if (cs) cs.scrollTop = cs.scrollHeight;
  if (S.ui.focus) { const f = document.querySelector(S.ui.focus); if (f) f.focus(); S.ui.focus = null; }
  renderToast();
}
function go(name, extra) {
  S.route = Object.assign({ name }, extra || {}); S.ui.sel = null; S.ui.chairSel = null; S.modal = null;
  if (name !== 'vote' && name !== 'result' && location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  render(); window.scrollTo(0, 0);
}
function confirmBox(title, body, ok, onOk, danger) { S.modal = { kind: 'confirm', title, body, ok, onOk, danger }; render(); }

// ---------- celebration ----------
function celebrate(title, sub) {
  const el = document.createElement('div'); el.className = 'celebrate'; el.setAttribute('role', 'status');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let conf = '';
  if (!reduce) for (let i = 0; i < 46; i++) { const c = ['var(--gold)', '#1A1918', '#E8D9B0', '#ffffff'][i % 4]; conf += `<i class="conf" style="left:${Math.random() * 100}%;background:${c};animation-duration:${1.8 + Math.random() * 1.6}s;animation-delay:${Math.random() * .5}s;${c === '#ffffff' ? 'border:1px solid #ddd;' : ''}"></i>`; }
  el.innerHTML = conf + `<div class="c-in"><img src="${LOGO}" alt="MAZLEG"><h2>${esc(title)}</h2><p class="muted" style="margin-top:6px">${esc(sub || '')}</p></div>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); }; el.addEventListener('click', close); setTimeout(close, 3000);
}

// ---------- wizard logic ----------
function newDraft(ev) {
  if (ev) {
    const d = JSON.parse(JSON.stringify({ name: ev.name, type: ev.type, customType: ev.customType, date: ev.date, expected: ev.expected, participants: ev.participants, layout: ev.layout, layoutMode: ev.layoutMode || 'custom', cfg: ev.cfg || suggestCfg(ev.participants.length) }));
    return Object.assign(d, { step: 0, editing: ev.id, saveFamily: true, errors: {} });
  }
  return { step: 0, name: '', type: 'friday', customType: '', date: nextFriday(), expected: 17, participants: [], layout: null, layoutMode: 'connected', cfg: suggestCfg(17), saveFamily: true, errors: {} };
}
function nextFriday() { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return d.toISOString().slice(0, 10); }
function addPerson(name, age, extra) {
  name = String(name || '').trim(); if (!name) return false;
  const a = age === '' || age == null || isNaN(+age) ? null : Math.max(0, Math.min(120, Math.round(+age)));
  S.draft.participants.push(Object.assign({ id: rid(5), name, age: a, group: 'none', photo: null, token: rid(8) }, extra || {}));
  return true;
}
function validateStep(i) {
  const d = S.draft; d.errors = {};
  if (i === 0 && !d.name.trim()) d.errors.name = true;
  if (i === 1) {
    if (d.participants.some((p) => !p.name.trim())) d.errors.people = t('emptyName');
    else if (d.participants.length < 2) d.errors.people = t('needPeople');
    else { const seen = {}, dup = []; d.participants.forEach((p) => { const k = p.name.trim().toLowerCase(); if (seen[k]) dup.push(p.name); seen[k] = 1; }); if (dup.length) d.errors.people = t('dupNames', { x: esc(dup.join(', ')) }); }
  }
  if (i === 2 && activeSeats(d.layout) < d.participants.length) d.errors.cap = t('capShort', { n: d.participants.length - activeSeats(d.layout) });
  return !Object.keys(d.errors).length;
}
function ensureLayout() {
  const d = S.draft;
  if (!d.layout) { d.cfg = fitCfg(d.layoutMode, suggestCfg(d.participants.length), d.participants.length); d.layout = buildLayout(d.layoutMode, d.cfg); }
}
function rebuildFromCfg() { const d = S.draft; if (d.layoutMode === 'custom') return; d.layout = buildLayout(d.layoutMode, d.cfg); S.ui.sel = null; }
function finishWizard() {
  const d = S.draft;
  for (let i = 0; i < 3; i++) if (!validateStep(i)) { d.step = i; render(); return; }
  if (d.saveFamily) {
    for (const p of d.participants) {
      let m = p.familyId && S.store.family.find((x) => x.id === p.familyId);
      if (!m) m = S.store.family.find((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
      if (!m) { m = { id: rid(6), name: p.name, age: p.age, photo: p.photo }; S.store.family.push(m); }
      else { m.name = p.name; if (p.age != null) m.age = p.age; if (p.photo) m.photo = p.photo; }
      p.familyId = m.id;
    }
  }
  let ev;
  if (d.editing) {
    ev = evById(d.editing);
    const ids = new Set(d.participants.map((p) => p.id));
    for (const k of Object.keys(ev.votes)) { if (!ids.has(k)) delete ev.votes[k]; else ev.votes[k].choices = ev.votes[k].choices.filter((x) => ids.has(x)); }
    ev.rules = (ev.rules || []).filter((r) => ids.has(r.a) && ids.has(r.b));
    const layoutChanged = JSON.stringify(ev.layout) !== JSON.stringify(d.layout) || ev.participants.length !== d.participants.length;
    Object.assign(ev, { name: d.name.trim(), type: d.type, customType: d.customType, date: d.date, expected: d.expected, participants: d.participants, layout: d.layout, layoutMode: d.layoutMode, cfg: d.cfg });
    if (layoutChanged) ev.plan = null;
  } else {
    ev = { id: (crypto.randomUUID ? crypto.randomUUID() : rid(8)), key: rid(10), createdAt: Date.now(), name: d.name.trim(), type: d.type, customType: d.customType, date: d.date, expected: d.expected, participants: d.participants, layout: d.layout, layoutMode: d.layoutMode, cfg: d.cfg, votingOpen: true, votes: {}, rules: [], plan: null };
    S.store.events.push(ev);
  }
  persist(); S.draft = null; openEvent(ev.id);
}

// ---------- event / links ----------
async function buildLinks(ev) {
  const base = { v: 1, e: ev.id, k: ev.key, n: ev.name, t: typeLabel(ev), d: ev.date || '', l: S.lang, p: ev.participants.map((p) => [p.id, p.name]) };
  const out = { invite: await makeLink('i', base), personal: {} };
  for (const p of ev.participants) out.personal[p.id] = await makeLink('i', Object.assign({}, base, { me: p.id, tk: p.token }));
  S.linkCache[ev.id] = out;
}
async function openEvent(id) {
  const ev = evById(id); if (!ev) { go('home'); return; }
  go('event', { id }); await buildLinks(ev); if (S.route.name === 'event' && S.route.id === id) render();
}

// ---------- replies ----------
async function importReply(str, fromHash) {
  let data;
  try { const m = String(str).match(/#v-([0-9a-z]+)/); data = await unpack(m ? m[1] : String(str).replace(/^v-/, '')); } catch (e) { toast(t('linkBroken')); return; }
  const ev = evById(data.e);
  if (!ev) { if (fromHash) go('home'); toast(t('replyUnknown')); return; }
  const p = pById(ev, data.p);
  if (data.k !== ev.key || !p || (data.tk && data.tk !== p.token)) { openEvent(ev.id); toast(t('replyBadKey')); return; }
  const ids = new Set(ev.participants.map((x) => x.id));
  const choices = (data.c || []).filter((x) => ids.has(x) && x !== p.id).slice(0, 2);
  if (!ev.votingOpen) {
    await openEvent(ev.id);
    confirmBox(t('replyClosed', { x: esc(p.name) }), '', t('reopenAccept'), () => { ev.votingOpen = true; applyVote(ev, p, choices, data.at, 'link'); });
    return;
  }
  const had = !!ev.votes[p.id];
  if (had && ev.votes[p.id].at > (data.at || 0)) { await openEvent(ev.id); toast(t('replyUpdated', { x: p.name })); return; }
  applyVote(ev, p, choices, data.at, 'link');
  await openEvent(ev.id); toast(t(had ? 'replyUpdated' : 'replyImported', { x: p.name }));
}
function applyVote(ev, p, choices, at, via) {
  ev.votes[p.id] = { choices, at: at || Date.now(), via };   // one active response per participant: newest replaces
  if (ev.plan) ev.plan.stale = true;
  persist(); render();
}

// ---------- voting ----------
function startVoteLocal(ev) {
  S.vote = { mode: 'local', full: ev, ev: { id: ev.id, name: ev.name, date: ev.date, participants: ev.participants }, step: 'who', me: null, draft: [] };
  go('vote');
}
function voteSelectMe(id) {
  const V = S.vote; V.me = id; V.step = 'pick';
  if (V.mode === 'local') {
    const prev = V.full.votes[id]; V.had = !!prev; V.draft = prev ? prev.choices.slice() : []; V.prev = null;
    const me = pById(V.full, id);
    if (!prev && me.familyId) V.prev = previousChoiceSuggestion(V.full, me);
  } else {
    const mine = S.store.myVotes[V.ev.id]; V.had = !!(mine && mine.me === id); V.draft = V.had ? mine.choices.slice() : [];
  }
  render(); window.scrollTo(0, 0);
}
function previousChoiceSuggestion(ev, me) {
  const past = S.store.events.filter((e) => e.id !== ev.id).sort((a, b) => b.createdAt - a.createdAt);
  for (const e of past) {
    const old = e.participants.find((p) => p.familyId === me.familyId); if (!old || !e.votes[old.id]) continue;
    const famIds = e.votes[old.id].choices.map((c) => (pById(e, c) || {}).familyId).filter(Boolean);
    const now = ev.participants.filter((p) => famIds.includes(p.familyId) && p.id !== me.id);
    if (now.length) return { ids: now.map((p) => p.id).slice(0, 2), names: now.map((p) => p.name).slice(0, 2) };
  }
  return null;
}
function togglePick(id) {
  const V = S.vote; if (id === V.me) return;
  const i = V.draft.indexOf(id);
  if (i >= 0) V.draft.splice(i, 1); else if (V.draft.length >= 2) { toast(t('maxTwo')); return; } else V.draft.push(id);
  render();
}
async function submitVote() {
  const V = S.vote;
  if (V.mode === 'local') {
    const ev = V.full; if (!ev.votingOpen) { V.closed = true; render(); return; }
    applyVote(ev, pById(ev, V.me), V.draft.slice(), Date.now(), 'device');
  } else {
    const at = Date.now();
    S.store.myVotes[V.ev.id] = { me: V.me, choices: V.draft.slice(), at }; persist();
    V.replyUrl = await makeLink('v', { v: 1, e: V.ev.id, k: V.ev.key, p: V.me, tk: V.tk && V.lockedMe === V.me ? V.tk : undefined, c: V.draft.slice(), at });
  }
  V.step = 'done'; S.modal = null; render(); window.scrollTo(0, 0);
}

// ---------- seating ----------
function generate(ev) {
  if (activeSeats(ev.layout) < ev.participants.length) { toast(t('cantSeat', { x: t('insufficient', { s: activeSeats(ev.layout), p: ev.participants.length }) })); return; }
  S.ui.busy = true; render();
  setTimeout(() => {
    const pl = ev.plan || { locked: [] };
    const seed = (pl.seed || 0) + 1;
    const res = E.optimize(Object.assign(engineInput(Object.assign({}, ev, { plan: pl })), { seed }));
    S.ui.busy = false;
    if (!res.ok) {
      const e = res.errors[0];
      toast(t('cantSeat', { x: e.code === 'insufficient_seats' ? t('insufficient', { s: e.seats, p: e.people }) : e.code }));
      render(); return;
    }
    const options = [res.best, ...res.alternatives];
    const errs = E.validateAssignment(engineInput(ev), res.best.assignment);
    if (errs.length) { toast('Engine error: ' + errs[0]); render(); return; }
    ev.plan = { options, active: 0, assignment: Object.assign({}, res.best.assignment), current: res.best, locked: (pl.locked || []).filter((c) => Object.values(res.best.assignment).includes(c)), seed, manual: false, dirty: true, stale: false, method: res.method, savedAt: pl.savedAt || null, publishedAt: null };
    persist();
    S.route = { name: 'seating', id: ev.id }; S.ui.chairSel = null; render(); window.scrollTo(0, 0);
    celebrate(t('ready'), t('readySub', { p: res.best.stats.satisfaction }));
  }, 80);
}
async function publish(ev) {
  const pl = ev.plan; const tIdx = new Map(ev.layout.tables.map((x, i) => [x.id, i])); const pIdx = new Map(ev.participants.map((p, i) => [p.id, i]));
  const byChair = {}; for (const [pid, cid] of Object.entries(pl.assignment)) byChair[cid] = pid;
  const payload = { v: 1, e: ev.id, n: ev.name, d: ev.date || '', l: S.lang, p: ev.participants.map((p) => p.name),
    T: ev.layout.tables.map((x) => [{ rect: 'r', round: 'c', oval: 'o' }[x.shape], Math.round(x.x), Math.round(x.y), Math.round(x.w), Math.round(x.h), x.rot || 0]),
    C: ev.layout.chairs.map((c) => [Math.round(c.x), Math.round(c.y), tIdx.get(c.tableId), byChair[c.id] != null ? pIdx.get(byChair[c.id]) : -1, c.disabled ? 1 : 0]) };
  const url = await makeLink('s', payload);
  pl.publishedAt = Date.now(); pl.savedAt = pl.savedAt || Date.now(); pl.dirty = false; pl.resultUrl = url; persist();
  S.present = { evId: ev.id, url }; render();
}
function decodeResult(d) {
  const shapes = { r: 'rect', c: 'round', o: 'oval' };
  const tables = d.T.map((x, i) => ({ id: 't' + i, shape: shapes[x[0]] || 'rect', x: x[1], y: x[2], w: x[3], h: x[4], rot: x[5] }));
  const participants = d.p.map((n, i) => ({ id: 'p' + i, name: n }));
  const chairs = d.C.map((c, i) => ({ id: 'c' + i, x: c[0], y: c[1], tableId: 't' + c[2], disabled: !!c[4] }));
  const assign = {}; d.C.forEach((c, i) => { if (c[3] >= 0) assign['p' + c[3]] = 'c' + i; });
  return { ev: { name: d.n, date: d.d, participants, layout: { tables, chairs } }, assign };
}

// ---------- assistant ----------
function openChat(ctx) {
  S.chat = { ctx, msgs: [], typing: false, input: '', stage: 0, demoForced: false };
  if (ctx === 'voter') S.chat.msgs.push({ role: 'bot', text: t('aiHi') }, { role: 'bot', text: t('aiQ1') });
  else S.chat.msgs.push({ role: 'bot', text: t('aiOrgHi') });
  S.modal = { kind: 'chat' }; render(); S.ui.focus = '#chat-in';
}
function findNames(text, people) {
  const s = ' ' + text.toLowerCase().replace(/[.,!?;:()"'״׳-]/g, ' ') + ' ';
  const hits = [];
  for (const p of people) {
    const full = p.name.toLowerCase(); const parts = full.split(/\s+/).filter((w) => w.length >= 2);
    const strip = (w) => [w, w.replace(/^[והבלמש]/, '')];
    const tokens = s.split(/\s+/).flatMap(strip);
    if (s.includes(' ' + full + ' ') || parts.some((w) => tokens.includes(w) && !['סבא', 'סבתא', 'דוד', 'דודה', 'grandma', 'grandpa', 'aunt', 'uncle'].includes(w)) || (parts.length > 1 && s.includes(full))) hits.push(p);
  }
  return hits;
}
function selectActions(people) {
  const acts = people.slice(0, 2).map((p) => ({ label: t('selectX', { x: p.name }), ids: [p.id] }));
  if (people.length >= 2) acts.push({ label: t('selectBoth'), ids: people.slice(0, 2).map((p) => p.id) });
  return acts;
}
function demoReply(text) {
  const C = S.chat; const low = text.toLowerCase();
  if (C.ctx === 'organizer') return { text: organizerDemo(low) };
  const V = S.vote; const others = V.ev.participants.filter((p) => p.id !== V.me);
  const found = findNames(text, others);
  if (found.length) return { text: t('aiFound', { x: found.slice(0, 2).map((p) => p.name).join(S.lang === 'he' ? ' ו' : ' and ') }), actions: selectActions(found) };
  if (/איך|how|work|עובד/.test(low)) return { text: t('aiHow') };
  if (/רואה|פרטי|privacy|see|who sees/.test(low)) return { text: t('aiPrivacy') };
  if (/מי מגיע|who.?s coming|coming|מגיעים/.test(low)) return { text: t('aiWho', { x: others.map((p) => p.name).join(', ') }) };
  if (/לא בטוח|לא יודע|not sure|unsure|don.?t know|help/.test(low)) { C.stage = (C.stage || 0) + 1; return { text: C.stage > 1 ? t('aiUnsure2') : t('aiUnsure1') }; }
  return { text: t('aiDefault') };
}
function organizerDemo(low) {
  const ev = evById(S.route.id); const cur = ev.plan.current; const st = cur.stats; const he = S.lang === 'he';
  const none = Object.entries(cur.perPerson).filter(([, x]) => x.fulfilled === 0).map(([id]) => (pById(ev, id) || {}).name);
  if (/שפר|better|improve|לשפר/.test(low)) return he
    ? `כמה רעיונות: (1) "סידור מחדש" בודק סידור חדש תוך שמירה על כיסאות נעולים. (2) אם חשוב לכם ש${none[0] || 'מישהו'} ישב ליד מישהו מסוים, נעלו אותם או הוסיפו כלל "לשבת יחד". (3) הוספת כיסא בראש השולחן נותנת עוד שכנים.`
    : `A few ideas: (1) "Re-arrange" tries a fresh plan while keeping locked seats. (2) If it matters that ${none[0] || 'someone'} sits beside a particular person, lock them or add a "sit together" rule. (3) Adding a head-of-table seat creates more neighbour pairs.`;
  if (/חלופ|alternativ|differ|הבדל/.test(low)) { const o = ev.plan.options || []; return he ? `יש ${o.length} חלופות. ${o.map((x, i) => `אפשרות ${i + 1}: ${x.stats.satisfaction}% (${x.stats.fulfilled}/${x.stats.total})`).join(' · ')}. ההבדלים הם בעיקר מי יושב בקצוות ובחיבורים בין השולחנות.` : `There are ${o.length} alternatives. ${o.map((x, i) => `Option ${i + 1}: ${x.stats.satisfaction}% (${x.stats.fulfilled}/${x.stats.total})`).join(' · ')}. They differ mostly in who sits at the ends and across table joins.`; }
  return he
    ? `${st.fulfilled} מתוך ${st.total} בקשות התמלאו${st.mutualPairs ? `, ו־${st.mutualMet} מתוך ${st.mutualPairs} הזוגות ההדדיים יושבים יחד` : ''}. ${none.length ? `ל${none.join(', ')} אף בחירה לא התממשה. ` : ''}הסיבה הנפוצה: לכל כיסא יש רק שניים־שלושה שכנים, וכשכמה אנשים בוחרים באותו אדם — לא כולם יכולים לשבת לידו.`
    : `${st.fulfilled} of ${st.total} requests were fulfilled${st.mutualPairs ? `, and ${st.mutualMet} of ${st.mutualPairs} mutual pairs sit together` : ''}. ${none.length ? `${none.join(', ')} got none of their picks. ` : ''}The usual reason: each seat has only two or three neighbours, so when several people pick the same person, not all can sit beside them.`;
}
async function chatSend(text) {
  const C = S.chat; text = String(text || '').trim(); if (!text || C.typing) return;
  C.msgs.push({ role: 'me', text }); C.input = ''; C.typing = true; render();
  let reply = null;
  if (S.sample && !C.demoForced) {
    try { reply = await aiReply(); }
    catch (e) {
      if (e && (e.code === 'not_granted' || e.code === 'ai_off')) { C.demoForced = true; C.msgs.push({ role: 'bot', text: t(e.code === 'ai_off' ? 'aiOff' : 'aiDeclined') }); }
      else if (!(e && e.code === 'cancelled')) C.msgs.push({ role: 'bot', text: t('aiErr') });
    }
  } else await new Promise((r) => setTimeout(r, 650));
  if (!reply) reply = demoReply(text);
  C.typing = false; C.msgs.push({ role: 'bot', text: reply.text, actions: reply.actions }); render(); S.ui.focus = '#chat-in';
}
async function aiReply() {
  const C = S.chat; const lang = S.lang === 'he' ? 'Hebrew' : 'English';
  const transcript = C.msgs.slice(-12).map((m) => (m.role === 'me' ? 'Person: ' : 'Mazleg: ') + m.text).join('\n');
  let prompt;
  if (C.ctx === 'voter') {
    const V = S.vote; const others = V.ev.participants.filter((p) => p.id !== V.me);
    prompt = `You are MAZLEG (מזלג), a warm, playful, brief seating helper shaped like a friendly golden fork with a moustache. You help ONE family member decide who to sit next to at "${V.ev.name}". They may pick up to two people.
Hard rules: never claim you submitted or changed anything — the person must tap a button to select and then confirm themselves. Never invent relationships, history or preferences. Never guess sensitive personal information. Never rank or suggest people by age. Only ever suggest people the person themself named or clearly described in this conversation; if they ask you to just pick, ask them a gentle question instead. Only the organizer sees choices — no family member sees others' choices.
Reply in ${lang}, at most 3 short sentences, friendly, no emoji.
Guests they can choose from (id: name): ${others.map((p) => p.id + ': ' + p.name).join('; ')}
Currently selected: ${V.draft.map((id) => (V.ev.participants.find((p) => p.id === id) || {}).name).join(', ') || 'nobody'}
Conversation:
${transcript}
Return ONLY JSON: {"reply": string, "suggest": [ids of at most 2 guests the person named, else empty]}`;
  } else {
    const ev = evById(S.route.id); const cur = ev.plan.current; const nm = (id) => (pById(ev, id) || {}).name;
    const per = Object.entries(cur.perPerson).map(([id, x]) => `${nm(id)}: ${x.fulfilled}/${x.requested}`).join('; ');
    prompt = `You are MAZLEG (מזלג), the friendly assistant of a family seating app. The organizer is asking about a seating plan that a dedicated optimization engine produced. You EXPLAIN and SUGGEST; you never assign seats yourself. Available organizer tools: Re-arrange (new search keeping locked seats), lock a seat, drag to swap, add "sit together"/"keep apart" rules, add or remove chairs in setup, compare alternatives. Do not invent relationships or reasons people chose each other. Do not use age as a criterion.
Reply in ${lang}, max 5 short sentences, no emoji.
Plan facts: ${cur.stats.fulfilled}/${cur.stats.total} requests fulfilled; ${cur.stats.mutualMet}/${cur.stats.mutualPairs} mutual pairs together; ${cur.stats.votersWithNone} voters got none. Per person fulfilled/requested: ${per}. Mutual pairs not together: ${(cur.unmetMutual || []).map(([a, b]) => nm(a) + ' & ' + nm(b)).join(', ') || 'none'}. Rule problems: ${(cur.violations || []).length}. Alternatives: ${(ev.plan.options || []).map((o, i) => 'Option ' + (i + 1) + ' ' + o.stats.satisfaction + '%').join(', ')}. Each seat has 2–3 neighbours.
Conversation:
${transcript}
Return ONLY JSON: {"reply": string}`;
  }
  const { text } = await S.sample(prompt, { modelTier: 'quick', cache: false });
  let obj; try { obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) { obj = { reply: text.trim() }; }
  const out = { text: String(obj.reply || '').slice(0, 900) || t('aiErr') };
  if (C.ctx === 'voter' && Array.isArray(obj.suggest)) {
    const V = S.vote; const ok = obj.suggest.map((id) => V.ev.participants.find((p) => p.id === id && p.id !== V.me)).filter(Boolean);
    if (ok.length) out.actions = selectActions(ok);
  }
  return out;
}
