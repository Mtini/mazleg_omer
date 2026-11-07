// ---------- production (server) mode ----------
// Active only when the build provides window.MAZLEG_CONFIG. The device-only prototype never runs this.
const CFG = window.MAZLEG_CONFIG || null;
const SERVER = !!CFG;
const SITE = CFG ? String(CFG.siteUrl || location.origin).replace(/\/+$/, '') : '';
let sb = null;
const SY = { ev: {}, mem: {} };          // last-synced snapshots
const PKEY = 'mazleg:prod:v1';

function saveLocal() {
  try { localStorage.setItem(PKEY, JSON.stringify({ settings: S.store.settings, sessions: S.store.sessions })); } catch (e) {}
}
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch (e) { return {}; }
}

// ---------- API: every call is a server-side authorized function ----------
async function rpc(name, args) {
  // Demo isolation: nothing leaves the browser while a demo session is active.
  if (S.demo) { const e = new Error('demo_mode'); e.code = 'demo_mode'; throw e; }
  const { data, error } = await sb.rpc(name, args || {});
  if (error) { const e = new Error(error.message || 'error'); e.code = error.message; e.pg = error.code; throw e; }
  return data;
}
const api = {
  myFamilies: () => rpc('my_families'),
  createFamily: (name) => rpc('create_family', { p_name: name }),
  renameFamily: (fid, name) => rpc('rename_family', { p_family: fid, p_name: name }),
  workspace: (fid) => rpc('get_workspace', { p_family: fid }),
  saveEvent: (fid, ev) => rpc('save_event', { p_family: fid, p_event: ev }),
  deleteEvent: (id) => rpc('delete_event', { p_event: id }),
  saveMember: (fid, m) => rpc('save_family_member', { p_family: fid, p_member: m }),
  deleteMember: (fid, id) => rpc('delete_family_member', { p_family: fid, p_id: id }),
  rotateInvite: (id) => rpc('rotate_invitation', { p_event: id }),
  revokeInvite: (id) => rpc('revoke_invitation', { p_event: id }),
  setPref: (id, pid, choices) => rpc('organizer_set_preference', { p_event: id, p_participant: pid, p_choices: choices }),
  resetClaim: (id, pid) => rpc('reset_participant_claim', { p_event: id, p_participant: pid }),
  publish: (id) => rpc('publish_arrangement', { p_event: id }),
  organizerInvite: (fid) => rpc('create_organizer_invite', { p_family: fid }),
  acceptOrganizer: (code) => rpc('accept_organizer_invite', { p_code: code }),
  join: (token) => rpc('join_event', { p_token: token }),
  claim: (token, pid, session) => rpc('claim_participant', { p_token: token, p_participant: pid, p_session: session || null }),
  myChoice: (session) => rpc('get_my_choice', { p_session: session }),
  submit: (session, choices) => rpc('submit_preference', { p_session: session, p_choices: choices }),
  published: (token) => rpc('get_published_seating', { p_token: token }),
};
function errText(e) {
  const k = 'err_' + (e && e.code);
  return I18N[S.lang][k] || I18N.en[k] ? t(k) : t('err_generic');
}

// ---------- sync: local edits → server, debounced, diff-based ----------
function serializeEvent(ev) {
  let plan = null;
  if (ev.plan && ev.plan.assignment) { plan = Object.assign({}, ev.plan); delete plan.resultUrl; delete plan.stale; delete plan.dirty; }
  return { id: ev.id, name: ev.name, type: ev.type, customType: ev.customType || null, date: ev.date || null, expected: ev.expected || null,
    layoutMode: ev.layoutMode, cfg: ev.cfg, rules: ev.rules || [], votingOpen: ev.votingOpen !== false,
    participants: ev.participants.map((p) => ({ id: p.id, name: p.name, age: p.age == null ? null : p.age, group: p.group || null, photo: p.photo || null, familyId: p.familyId || null })),
    layout: { tables: ev.layout.tables, chairs: ev.layout.chairs.map((c) => ({ id: c.id, tableId: c.tableId, x: c.x, y: c.y, disabled: !!c.disabled })) }, plan };
}
const memJson = (m) => JSON.stringify({ id: m.id, name: m.name, age: m.age == null ? null : m.age, photo: m.photo || null });
function snapshot() {
  SY.ev = {}; SY.mem = {};
  for (const ev of S.store.events) SY.ev[ev.id] = JSON.stringify(serializeEvent(ev));
  for (const m of S.store.family) SY.mem[m.id] = memJson(m);
}
let syncTimer = 0, syncing = false, syncAgain = false;
function setSync(st) { S.syncState = st; const el = document.getElementById('sync'); if (el) { el.dataset.state = st; el.textContent = t('sync_' + st); } }
function scheduleSync() { if (!S.family || S.demo) return; clearTimeout(syncTimer); setSync('saving'); syncTimer = setTimeout(runSync, 500); }
async function runSync() {
  if (!S.family || S.demo) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; const fid = S.family.id;
  try {
    const ids = new Set(S.store.events.map((e) => e.id));
    for (const ev of S.store.events) {
      if (!ev.participants.length || !ev.layout) continue;
      const j = JSON.stringify(serializeEvent(ev));
      if (SY.ev[ev.id] !== j) { await api.saveEvent(fid, JSON.parse(j)); SY.ev[ev.id] = j; }
    }
    for (const id of Object.keys(SY.ev)) if (!ids.has(id)) { await api.deleteEvent(id); delete SY.ev[id]; }
    const mids = new Set(S.store.family.map((m) => m.id));
    for (const m of S.store.family) { const j = memJson(m); if (SY.mem[m.id] !== j && m.name.trim()) { await api.saveMember(fid, JSON.parse(j)); SY.mem[m.id] = j; } }
    for (const id of Object.keys(SY.mem)) if (!mids.has(id)) { await api.deleteMember(fid, id); delete SY.mem[id]; }
    setSync('saved');
  } catch (e) {
    setSync('error'); toast(errText(e)); clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 6000);
  } finally {
    syncing = false; if (syncAgain) { syncAgain = false; runSync(); }
  }
}
async function flushSync() { clearTimeout(syncTimer); await runSync(); while (syncing) await new Promise((r) => setTimeout(r, 50)); }

// ---------- workspace ----------
async function loadWorkspace(fid) {
  const ws = await api.workspace(fid);
  S.family = ws.family; S.store.events = ws.events || []; S.store.family = ws.members || [];
  for (const ev of S.store.events) { ev.votes = ev.votes || {}; ev.rules = ev.rules || []; if (ev.plan && !ev.plan.current && ev.plan.assignment) ev.plan.current = E.evaluate(engineInput(ev), ev.plan.assignment); }
  snapshot(); S.store.settings.familyId = fid; saveLocal(); setSync('saved');
}
async function enterWorkspace(preferId) {
  S.families = await api.myFamilies();
  if (S.pendingCode) {
    const code = S.pendingCode; S.pendingCode = null;
    try { preferId = await api.acceptOrganizer(code); S.families = await api.myFamilies(); toast(t('joinedFamily')); } catch (e) { toast(errText(e)); }
  }
  if (!S.families.length) { goServer('onboard'); return; }
  const fid = (preferId && S.families.find((f) => f.id === preferId) ? preferId : null) || (S.families.find((f) => f.id === S.store.settings.familyId) || S.families[0]).id;
  await loadWorkspace(fid); goServer('home');
}
async function refreshLive() {
  if (S.demo || !S.family || !['event', 'seating', 'home'].includes(S.route.name) || document.hidden || syncing) return;
  try {
    const ws = await api.workspace(S.family.id); let changed = false;
    for (const sev of ws.events || []) {
      const ev = evById(sev.id); if (!ev) continue;
      const before = JSON.stringify([ev.votes, ev.invite, ev.participants.map((p) => p.claimed)]);
      ev.votes = sev.votes || {}; ev.invite = sev.invite || null;
      const cl = new Map(sev.participants.map((p) => [p.id, p.claimed])); ev.participants.forEach((p) => { if (cl.has(p.id)) p.claimed = cl.get(p.id); });
      if (before !== JSON.stringify([ev.votes, ev.invite, ev.participants.map((p) => p.claimed)])) { changed = true; if (ev.plan && ev.plan.assignment) ev.plan.stale = true; }
    }
    if (changed && !S.modal && !document.activeElement.matches('input,textarea,select')) render();
  } catch (e) {}
}
function goServer(name, extra) {
  if (['welcome', 'auth', 'onboard'].includes(name) && location.pathname !== '/') { try { history.replaceState(null, '', '/'); } catch (e) {} }
  go(name, extra);
}
const inviteUrl = (ev, pid) => ev.invite ? SITE + '/join/' + ev.invite.token + (pid ? '?p=' + encodeURIComponent(pid) : '') : '';

// ---------- guest flow: /join/TOKEN ----------
async function openJoin(token, pre) {
  S.route = { name: 'loading' }; render();
  let j;
  try { j = await api.join(token); }
  catch (e) { S.joinError = e.code === 'invalid_invitation' ? 'invalid' : 'generic'; S.route = { name: 'joinError' }; render(); return; }
  const ev = { name: j.event.name, date: j.event.date, participants: j.participants, votingOpen: j.event.votingOpen, published: j.event.published };
  S.vote = { mode: 'server', token, ev, step: 'who', me: null, draft: [], closed: false };
  if (ev.published && !ev.votingOpen) { await openPublished(); return; }
  S.route = { name: 'vote' }; render();
  const stored = S.store.sessions[token];
  const want = pre && ev.participants.some((p) => p.id === pre) ? pre : stored && stored.pid;
  if (want && stored && stored.pid === want) await serverClaim(want);
}
async function serverClaim(pid) {
  const V = S.vote; const stored = S.store.sessions[V.token];
  try {
    const session = await api.claim(V.token, pid, stored && stored.pid === pid ? stored.session : null);
    S.store.sessions[V.token] = { pid, session }; saveLocal();
    const mine = await api.myChoice(session);
    Object.assign(V, { me: pid, session, draft: mine.choices || [], had: !!mine.submitted, closed: !mine.votingOpen, step: mine.submitted ? 'done' : 'pick' });
    render(); window.scrollTo(0, 0);
  } catch (e) { toast(errText(e)); if (e.code === 'invalid_invitation') { S.joinError = 'invalid'; S.route = { name: 'joinError' }; render(); } }
}
async function openPublished() {
  const V = S.vote;
  try {
    const d = await api.published(V.token);
    S.remote = { ev: { name: d.event.name, date: d.event.date, participants: d.participants, layout: d.layout }, assign: d.assignment };
    const st = S.store.sessions[V.token]; if (st && d.assignment[st.pid]) S.ui.findMe = st.pid;
    S.route = { name: 'result' }; render(); window.scrollTo(0, 0);
  } catch (e) { toast(errText(e)); }
}

// ---------- server versions of shared functions ----------
if (SERVER) {
  const local = loadLocal();
  S.store = { events: [], family: [], settings: Object.assign({}, local.settings || {}), myVotes: {}, sessions: local.sessions || {} };
  S.lang = S.store.settings.lang || 'he';
  S.sample = CFG.ai === false ? null : true;
  S.families = []; S.family = null;

  persist = function () { saveLocal(); scheduleSync(); };
  openEvent = async function (id) {
    const ev = evById(id); if (!ev) { goServer('home'); return; }
    go('event', { id });
    if (!ev.invite) { try { await flushSync(); ev.invite = { token: await api.rotateInvite(ev.id) }; render(); } catch (e) { toast(errText(e)); } }
  };
  buildLinks = async function () {};
  applyVote = function (ev, p, choices, at, via) {
    ev.votes[p.id] = { choices, at: at || Date.now(), via: via === 'device' ? 'organizer' : via };
    if (ev.plan) ev.plan.stale = true;
    render();
    api.setPref(ev.id, p.id, choices).catch((e) => toast(errText(e)));
  };
  publish = async function (ev) {
    try {
      ev.plan.savedAt = ev.plan.savedAt || Date.now(); ev.plan.dirty = false;
      await flushSync();
      if (!ev.invite) ev.invite = { token: await api.rotateInvite(ev.id) };
      await api.publish(ev.id); ev.plan.publishedAt = Date.now(); persist();
      S.present = { evId: ev.id, url: inviteUrl(ev) }; render();
    } catch (e) { toast(errText(e)); }
  };
  const _voteSelectMe = voteSelectMe;
  voteSelectMe = function (id) {
    if (S.vote.mode !== 'server') return _voteSelectMe(id);
    const p = S.vote.ev.participants.find((x) => x.id === id);
    const stored = S.store.sessions[S.vote.token];
    if (stored && stored.pid === id) { serverClaim(id); return; }
    confirmBox(t('confirmMe', { x: esc(p.name) }), t('confirmMeBody'), t('yesItsMe'), () => serverClaim(id));
  };
  const _submitVote = submitVote;
  submitVote = async function () {
    const V = S.vote; if (V.mode !== 'server') return _submitVote();
    try { await api.submit(V.session, V.draft.slice()); V.had = true; V.step = 'done'; S.modal = null; render(); window.scrollTo(0, 0); }
    catch (e) { S.modal = null; if (e.code === 'voting_closed') { V.closed = true; render(); } else { render(); toast(errText(e)); } }
  };
  aiReply = async function () {
    const C = S.chat;
    if (C.ctx === 'voter' && !(S.vote && S.vote.session)) { const e = new Error('off'); e.code = 'ai_off'; throw e; }
    const body = C.ctx === 'voter' ? { mode: 'voter', session: S.vote.session, selected: S.vote.draft } : { mode: 'organizer', familyId: S.family.id, eventId: S.route.id };
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(CFG.supabaseUrl.replace(/\/+$/, '') + '/functions/v1/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + ((session && session.access_token) || CFG.supabaseAnonKey) },
      body: JSON.stringify(Object.assign(body, { messages: C.msgs.slice(-12), lang: S.lang })),
    }).catch(() => null);
    if (!r || !r.ok) { const e = new Error('off'); e.code = 'ai_off'; throw e; }
    const j = await r.json(); const out = { text: j.reply || t('aiErr') };
    if (C.ctx === 'voter' && Array.isArray(j.suggest)) { const ok = j.suggest.map((id) => S.vote.ev.participants.find((p) => p.id === id && p.id !== S.vote.me)).filter(Boolean); if (ok.length) out.actions = selectActions(ok); }
    return out;
  };
  handleHash = async function () { return false; };

  inviteCard = function (ev) {
    const url = inviteUrl(ev); const text = t('waInvite', { x: ev.name });
    return `<div class="card">
      <h3>${t('invite')}</h3><p class="muted small" style="margin:6px 0 14px">${t('inviteLeadServer')}</p>
      ${url ? `<div class="linkbox"><input class="inp" readonly value="${esc(url)}" aria-label="${esc(t('invite'))}" data-act="selectAll"><button class="btn dark" data-act="copy" data-v="${esc(url)}">${ic('copy')} ${t('copy')}</button></div>
      <div class="row" style="margin-top:10px">
        <a class="btn" href="${esc(waHref(text + '\n' + url))}" target="_blank" rel="noopener">${ic('msg')} ${t('whatsapp')}</a>
        <button class="btn" data-act="share" data-title="${esc(ev.name)}" data-text="${esc(text)}" data-url="${esc(url)}">${ic('share')} ${t('share')}</button>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="inviteRotate">${ic('refresh')} ${t('newLink')}</button>
        <button class="btn sm ghost danger" data-act="inviteRevoke">${ic('x')} ${t('revokeLink')}</button>
      </div>` : `<div class="empty" style="padding:16px">${t('noActiveLink')}</div><div class="row" style="margin-top:10px"><button class="btn gold" data-act="inviteRotate">${ic('link')} ${t('createLink')}</button></div>`}
    </div>`;
  };
  personRowActions = function (ev, p) {
    const url = inviteUrl(ev, p.id);
    const claimed = p.claimed && !ev.votes[p.id] ? `<span class="pill">${t('opened')}</span>` : '';
    return `${claimed}${url ? `<a class="btn icon ghost" href="${esc(waHref(t('waInvite', { x: ev.name }) + '\n' + url))}" target="_blank" rel="noopener" aria-label="${t('whatsapp')} ${esc(p.name)}">${ic('msg')}</a><button class="btn icon ghost" data-act="copy" data-v="${esc(url)}" aria-label="${t('copy')} ${esc(p.name)}">${ic('link')}</button>` : ''}
      ${p.claimed ? `<button class="btn icon ghost" data-act="resetClaim" data-id="${p.id}" aria-label="${esc(t('resetClaim'))} ${esc(p.name)}" title="${esc(t('resetClaim'))}">${ic('rot')}</button>` : ''}`;
  };
  replyBox = function () { return ''; };
}

// ---------- server-only views ----------
function familyBar() {
  if (!SERVER || !S.family) return '';
  return `<div class="fam-bar"><span class="evicon" style="width:36px;height:36px">${ic('users', ' width="18" height="18"')}</span><div style="flex:1;min-width:0"><b>${esc(S.family.name)}</b><div class="tiny muted">${S.demo ? t('demoWorkspace') : t('workspace')}</div></div>
    ${S.demo ? '' : `<span id="sync" class="sync" data-state="${S.syncState || 'saved'}">${t('sync_' + (S.syncState || 'saved'))}</span>`}</div>`;
}
function viewWelcome() {
  return `<section class="hero">
    <div><h1>${t('heroTitle')}</h1><p class="lead">${t('welcomeLead')}</p>
      <div class="row"><button class="btn gold lg" data-act="authStart" data-mode="signup">${ic('plus')} ${t('createFamily')}</button>
      <button class="btn lg" data-act="demoStart">${ic('eye')} ${t('tryDemo')}</button>
      <button class="btn ghost lg" data-act="authStart" data-mode="signin">${t('signIn')}</button></div>
      <p class="small muted" style="margin-top:18px">${t('guestNote')}</p></div>
    <div class="mascot" aria-hidden="true"><div class="bubble">${t('mascotHi')}</div><div class="disc"></div><img src="${LOGO}" alt=""></div>
  </section>
  <div class="section-h"><h2>${t('how')}</h2></div>
  <div class="steps3">${[1, 2, 3].map((i) => `<div class="s"><div class="n">${i}</div><h3>${t('how' + i + 't')}</h3><p class="muted small" style="margin-top:6px">${t('how' + i)}</p></div>`).join('')}</div>`;
}
function viewAuth() {
  const m = S.ui.authMode || 'signin';
  return `<div class="narrow" style="max-width:440px"><div class="vote-head"><img src="${LOGO}" alt=""><h2 style="margin-top:8px">${m === 'signup' ? t('createAccount') : t('signIn')}</h2>
    <p class="muted small" style="margin-top:6px">${m === 'signup' ? t('signupLead') : t('signinLead')}</p></div>
    <div class="card stack">
      <div><label class="f" for="au-email">${t('email')}</label><input id="au-email" class="inp" type="email" autocomplete="email" inputmode="email" dir="ltr" value="${esc(S.ui.authEmail || '')}"></div>
      <div><label class="f" for="au-pass">${t('password')}</label><input id="au-pass" class="inp" type="password" autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}" dir="ltr" minlength="8"></div>
      ${S.ui.authMsg ? `<div class="banner">${ic('info')}<span>${S.ui.authMsg}</span></div>` : ''}
      <button class="btn gold lg" style="width:100%" data-act="authSubmit">${m === 'signup' ? t('createAccount') : t('signIn')}</button>
      <div class="row" style="justify-content:space-between"><button class="btn ghost sm" data-act="authStart" data-mode="${m === 'signup' ? 'signin' : 'signup'}">${m === 'signup' ? t('haveAccount') : t('noAccount')}</button>
      ${m === 'signin' ? `<button class="btn ghost sm" data-act="authReset">${t('forgot')}</button>` : ''}</div>
    </div></div>`;
}
function viewOnboard() {
  return `<div class="narrow"><div class="vote-head"><img src="${LOGO}" alt=""><h2 style="margin-top:8px">${t('onboardTitle')}</h2><p class="muted" style="margin-top:6px">${t('onboardLead')}</p></div>
    <div class="grid2">
      <div class="card stack"><h3>${t('createFamily')}</h3><p class="small muted">${t('createFamilyLead')}</p>
        <input id="fam-name" class="inp" placeholder="${esc(t('familyNamePh'))}" maxlength="80"><button class="btn gold" data-act="famCreate">${t('createFamily')}</button></div>
      <div class="card stack"><h3>${t('joinFamily')}</h3><p class="small muted">${t('joinFamilyLead')}</p>
        <input id="org-code" class="inp" placeholder="${esc(t('codePh'))}" dir="ltr" maxlength="32" value="${esc(S.pendingCode || '')}"><button class="btn dark" data-act="famJoin">${t('joinFamily')}</button></div>
    </div>
    <div style="text-align:center;margin-top:20px"><button class="btn ghost sm" data-act="signOut">${t('signOut')}</button></div></div>`;
}
function viewSetup() {
  return `<div class="narrow"><div class="vote-head"><img src="${LOGO}" alt=""><h2 style="margin-top:8px">${t('setupTitle')}</h2></div><div class="card"><p>${t('setupBody')}</p></div></div>`;
}
function viewJoinError() {
  return `<div class="narrow"><div class="vote-head"><img src="${LOGO}" alt=""><h2 style="margin-top:8px">${S.joinError === 'invalid' ? t('linkInvalidT') : t('err_generic')}</h2></div>
    <div class="card" style="text-align:center"><p>${S.joinError === 'invalid' ? t('linkInvalidB') : ''}</p></div></div>`;
}
function familySettings() {
  if (!SERVER || !S.family) return '';
  return `<div class="card stack" style="margin-top:22px"><h3>${t('familySettings')}</h3>
    <div><label class="f" for="fam-rename">${t('familyName')}</label><div class="linkbox"><input id="fam-rename" class="inp" value="${esc(S.family.name)}" maxlength="80"><button class="btn" data-act="famRename">${t('save')}</button></div></div>
    <div><span class="f" style="display:block;font-weight:600;font-size:.9rem;margin-bottom:6px">${t('organizers')} <span class="pill">${S.family.organizers || 1}</span></span>
      <p class="small muted" style="margin-bottom:8px">${t('organizerInviteLead')}</p>
      ${S.ui.orgLink ? `<div class="linkbox"><input class="inp" readonly value="${esc(S.ui.orgLink)}" data-act="selectAll" dir="ltr"><button class="btn dark" data-act="copy" data-v="${esc(S.ui.orgLink)}">${ic('copy')} ${t('copy')}</button></div><p class="hint">${t('organizerInviteHint')}</p>`
        : `<button class="btn" data-act="orgInvite">${ic('plus')} ${t('inviteOrganizer')}</button>`}</div>
    ${S.families.length > 1 ? `<div><label class="f" for="fam-switch">${t('switchFamily')}</label><select id="fam-switch" class="inp" data-in="famSwitch">${S.families.map((f) => `<option value="${f.id}" ${f.id === S.family.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>` : ''}
    <div class="row">${S.install ? `<button class="btn" data-act="install">${ic('phone')} ${t('installApp')}</button>` : ''}<button class="btn ghost" data-act="famAnother">${ic('plus')} ${t('anotherFamily')}</button><span class="spacer"></span><button class="btn ghost danger" data-act="signOut">${t('signOut')}</button></div>
  </div>`;
}

if (SERVER) {
  Object.assign(VIEWS, { welcome: viewWelcome, auth: viewAuth, onboard: viewOnboard, setup: viewSetup, joinError: viewJoinError,
    loading: () => `<div class="loader"><img src="${LOGO}" alt=""></div>` });
  const _home = VIEWS.home, _family = VIEWS.family;
  const guard = (fn) => () => (S.family ? fn() : viewWelcome());
  VIEWS.home = guard(_home); VIEWS.family = guard(() => _family() + familySettings());
  VIEWS.event = guard(VIEWS.event); VIEWS.seating = guard(VIEWS.seating); VIEWS.wizard = guard(VIEWS.wizard);
  const _header = header;
  header = function () {
    if (!S.family && ['welcome', 'auth', 'onboard', 'setup', 'joinError', 'loading'].includes(S.route.name)) {
      return `<header class="top"><div class="top-in"><span class="brand"><img src="${LOGO}" alt=""><span><b>MAZLEG</b><small>${esc(t('tagline'))}</small></span></span><nav><button class="lang" data-act="lang" aria-label="Language">${t('langSwitch')}</button></nav></div></header>`;
    }
    return _header();
  };

  Object.assign(A, {
    authStart(el) { S.ui.authMode = el.dataset.mode; S.ui.authMsg = ''; goServer('auth'); S.ui.focus = '#au-email'; render(); },
    async authSubmit() {
      const email = document.getElementById('au-email').value.trim(), password = document.getElementById('au-pass').value;
      S.ui.authEmail = email;
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) { S.ui.authMsg = t('authInvalid'); render(); return; }
      let res;
      try { res = S.ui.authMode === 'signup' ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: SITE + '/' } }) : await sb.auth.signInWithPassword({ email, password }); }
      catch (e) { S.ui.authMsg = t('err_network'); render(); return; }
      if (res.error) { S.ui.authMsg = esc(res.error.message); render(); return; }
      if (!res.data.session) { S.ui.authMode = 'signin'; S.ui.authMsg = t('checkEmail'); render(); return; }
      S.auth = res.data.session; S.ui.authMsg = ''; try { await enterWorkspace(); } catch (e) { S.ui.authMsg = errText(e); render(); }
    },
    async authReset() {
      const email = document.getElementById('au-email').value.trim(); if (!email) { S.ui.authMsg = t('authInvalid'); render(); return; }
      await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE + '/' }); S.ui.authMsg = t('resetSent'); render();
    },
    async famCreate() {
      const n = document.getElementById('fam-name').value.trim(); if (!n) { toast(t('needName')); return; }
      try { const id = await api.createFamily(n); S.families = await api.myFamilies(); await loadWorkspace(id); goServer('home'); } catch (e) { toast(errText(e)); }
    },
    async famJoin() {
      const c = document.getElementById('org-code').value.trim(); if (!c) return;
      try { const id = await api.acceptOrganizer(c); S.families = await api.myFamilies(); await loadWorkspace(id); toast(t('joinedFamily')); goServer('home'); } catch (e) { toast(errText(e)); }
    },
    async famRename() { const n = document.getElementById('fam-rename').value.trim(); if (!n) return; try { await api.renameFamily(S.family.id, n); S.family.name = n; S.families = await api.myFamilies(); toast(t('saved')); render(); } catch (e) { toast(errText(e)); } },
    async orgInvite() { try { const code = await api.organizerInvite(S.family.id); S.ui.orgLink = SITE + '/?organizer=' + code; render(); } catch (e) { toast(errText(e)); } },
    famAnother() { goServer('onboard'); },
    async signOut() { await flushSync().catch(() => {}); await sb.auth.signOut(); S.family = null; S.families = []; S.store.events = []; S.store.family = []; S.store.settings.familyId = null; saveLocal(); goServer('welcome'); },
    async inviteRotate() {
      const ev = evById(S.route.id);
      const doIt = async () => { try { await flushSync(); ev.invite = { token: await api.rotateInvite(ev.id) }; render(); toast(t('linkCreated')); } catch (e) { toast(errText(e)); } };
      if (ev.invite) confirmBox(t('newLink'), t('newLinkBody'), t('newLink'), doIt); else doIt();
    },
    inviteRevoke() { const ev = evById(S.route.id); confirmBox(t('revokeLink'), t('revokeBody'), t('revokeLink'), async () => { try { await api.revokeInvite(ev.id); ev.invite = null; render(); } catch (e) { toast(errText(e)); } }, true); },
    resetClaim(el) { const ev = evById(S.route.id); const p = pById(ev, el.dataset.id); confirmBox(t('resetClaim'), t('resetClaimBody', { x: esc(p.name) }), t('resetClaim'), async () => { try { await api.resetClaim(ev.id, p.id); p.claimed = false; render(); } catch (e) { toast(errText(e)); } }); },
    openPublished() { openPublished(); },
    async install() { if (!S.install) return; S.install.prompt(); await S.install.userChoice.catch(() => {}); S.install = null; render(); },
  });
  const _voteNotMe = A.voteNotMe;
  A.voteNotMe = function () { if (S.vote && S.vote.mode === 'server') { S.vote.step = 'who'; S.vote.me = null; S.vote.session = null; S.vote.draft = []; render(); } else _voteNotMe(); };
  Object.assign(INPUTS, { async famSwitch(el) { await flushSync(); await loadWorkspace(el.value); goServer('home'); } });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.install = e; if (S.route.name === 'family') render(); });
  setInterval(refreshLive, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLive(); });
}

async function bootServer() {
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) { S.route = { name: 'setup' }; render(); return; }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  { // Demo isolation at the client itself: while a demo session is active, no RPC can leave the browser.
    const rawRpc = sb.rpc.bind(sb);
    sb.rpc = (name, args, opts) => (S.demo ? Promise.resolve({ data: null, error: { message: 'demo_mode', code: 'demo_mode' } }) : rawRpc(name, args, opts));
  }
  if ('serviceWorker' in navigator && CFG.serviceWorker !== false) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const m = location.pathname.match(/^\/join\/([A-Za-z0-9_-]{20,100})\/?$/);
  if (m) { await openJoin(m[1], new URLSearchParams(location.search).get('p')); return; }
  const code = new URLSearchParams(location.search).get('organizer'); if (code) S.pendingCode = code;
  S.route = { name: 'loading' }; render();
  const { data } = await sb.auth.getSession(); S.auth = data.session;
  sb.auth.onAuthStateChange((evt, session) => { S.auth = session; });
  if (!S.auth) { S.ui.authMode = 'signup'; goServer(code ? 'auth' : 'welcome'); return; }
  try { await enterWorkspace(); } catch (e) { toast(errText(e)); goServer('welcome'); }
}
