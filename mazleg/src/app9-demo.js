// ---------- demo mode ----------
// A demo session lives only in this browser, under its own storage key, and is never sent anywhere:
// in the production build every API call throws while S.demo is set (see rpc()). Real data is parked
// untouched in memory and restored on exit.
const DEMO_KEY = 'mazleg:demo:v1';
function demoSave() { try { localStorage.setItem(DEMO_KEY, JSON.stringify({ v: 1, lang: S.demoLang, store: S.store })); } catch (e) {} }
function demoLoad() { try { const d = JSON.parse(localStorage.getItem(DEMO_KEY)); return d && d.v === 1 && d.store && d.store.events ? d : null; } catch (e) { return null; } }

function makeDemoData() {
  const he = S.lang === 'he';
  const names = he ? ['סבתא רחל', 'סבא משה', 'דני', 'מיכל', 'נועם', 'אופיר', 'יעל', 'איתי', 'שירה', 'עומר', 'תמר', 'אורי', 'מאיה', 'רון', 'דנה', 'גיל', 'ליה']
    : ['Grandma Rachel', 'Grandpa Moshe', 'Danny', 'Michal', 'Noam', 'Ofir', 'Yael', 'Itai', 'Shira', 'Omer', 'Tamar', 'Uri', 'Maya', 'Ron', 'Dana', 'Gil', 'Lia'];
  const ages = [82, 85, 56, 54, 29, 27, 31, 33, 24, 22, 19, 16, 13, 10, 35, 8, 6];
  const family = names.map((n, i) => ({ id: 'demo-m' + i, name: n, age: ages[i], photo: null }));
  const people = () => family.map((m, i) => ({ id: 'demo-p' + i, name: m.name, age: m.age, group: 'none', photo: null, token: rid(8), familyId: m.id }));
  const votesFrom = (ps, map) => { const v = {}; for (const [i, arr] of Object.entries(map)) v[ps[i].id] = { choices: arr.map((j) => ps[j].id), at: Date.now() - 3600e3, via: 'demo' }; return v; };
  // Upcoming Friday dinner: 3 connected tables, 14 of 17 have chosen, seating not arranged yet.
  const cfg = { tables: 3, perSide: 3, heads: true, orient: 'horizontal', seats: 18, count: 2, seatsEach: 9 };
  const ps1 = people();
  const friday = { id: 'demo-friday', key: rid(10), demo: true, createdAt: Date.now() - 2 * 864e5, name: he ? 'ארוחת שישי אצל סבתא' : "Friday dinner at Grandma's", type: 'friday', date: nextFriday(), expected: 17,
    participants: ps1, layout: buildLayout('connected', cfg), layoutMode: 'connected', cfg, votingOpen: true, rules: [], plan: null,
    votes: votesFrom(ps1, { 0: [1, 2], 1: [0, 3], 2: [3, 4], 3: [2, 6], 4: [5, 7], 5: [4, 8], 6: [7, 0], 7: [6, 4], 8: [9, 10], 9: [8, 11], 10: [8, 12], 11: [13, 9], 13: [11, 15], 14: [3, 6] }) };
  // A past holiday dinner around two round tables, already arranged and published.
  const cfg2 = { tables: 1, perSide: 3, heads: true, orient: 'horizontal', seats: 18, count: 2, seatsEach: 9 };
  const ps2 = people();
  const holiday = { id: 'demo-holiday', key: rid(10), demo: true, createdAt: Date.now() - 60 * 864e5, name: he ? 'ערב ראש השנה' : 'New Year holiday dinner', type: 'holiday', date: new Date(Date.now() - 58 * 864e5).toISOString().slice(0, 10), expected: 17,
    participants: ps2, layout: buildLayout('separate', cfg2), layoutMode: 'separate', cfg: cfg2, votingOpen: false, rules: [],
    votes: votesFrom(ps2, { 0: [1, 14], 1: [0, 2], 2: [3, 1], 3: [2, 14], 4: [5, 8], 5: [4, 6], 6: [7, 5], 7: [6, 9], 8: [4, 10], 9: [7, 11], 10: [8, 12], 11: [12, 9], 12: [11, 10], 13: [15, 16], 14: [3, 0], 15: [13, 16], 16: [15, 13] }), plan: null };
  const r = E.optimize(Object.assign(engineInput(holiday), { seed: 7 }));
  if (r.ok) holiday.plan = { options: [r.best, ...r.alternatives], active: 0, assignment: Object.assign({}, r.best.assignment), current: r.best, locked: [], seed: 7, manual: false, dirty: false, stale: false, savedAt: Date.now() - 58 * 864e5, publishedAt: Date.now() - 58 * 864e5 };
  return { events: [friday, holiday], family, settings: { lang: S.lang }, myVotes: {}, sessions: {} };
}

async function enterDemo(fresh) {
  if (S.demo) return;
  if (SERVER && S.family && typeof flushSync === 'function') { try { await flushSync(); } catch (e) {} }   // real edits are saved first
  S.real = { store: S.store, family: S.family, families: S.families, route: S.route, linkCache: S.linkCache };
  const saved = !fresh && demoLoad();
  S.demo = true; S.demoLang = saved ? saved.lang : S.lang;
  S.store = saved ? saved.store : makeDemoData(); S.linkCache = {};
  if (saved) S.lang = saved.lang;
  S.family = { id: 'demo', name: S.lang === 'he' ? 'משפחת מזלג (הדגמה)' : 'The Mazleg family (demo)', organizers: 1 };
  S.families = [S.family];
  demoSave(); go('home');
}
function exitDemo(then) {
  if (!S.demo) return;
  S.demo = false; S.chat = null; S.present = null; S.vote = null;
  Object.assign(S, { store: S.real.store, family: S.real.family, families: S.real.families || [], linkCache: S.real.linkCache || {} });
  S.real = null;
  if (then) then(); else if (SERVER && !S.family) goServer('welcome'); else go('home');
}
function demoBanner() {
  if (!S.demo) return '';
  return `<div class="demo-bar" role="note"><div class="demo-in"><span class="demo-badge">${ic('eye')} ${t('demoBadge')}</span>
    <span class="demo-text">${t('demoBarText')}</span><span class="spacer"></span>
    <button class="btn sm gold" data-act="demoOwn">${t('demoOwn')}</button>
    <button class="btn sm ghost" data-act="demoReset">${ic('refresh')} ${t('demoReset')}</button>
    <button class="btn sm ghost" data-act="demoExit">${t('demoExit')}</button></div></div>`;
}
function demoInviteCard(ev) {
  return `<div class="card"><h3>${t('invite')}</h3><p class="muted small" style="margin:6px 0 14px">${t('demoInviteLead')}</p>
    <div class="row"><button class="btn gold" data-act="voteLocal" ${ev.votingOpen ? '' : 'disabled'}>${ic('phone')} ${t('demoTryVoting')}</button></div></div>`;
}

// ---- wire demo into shared functions (wrapping whichever versions are active: prototype or server) ----
{
  const _persist = persist; persist = function () { if (S.demo) { demoSave(); return; } _persist(); };
  const _openEvent = openEvent; openEvent = function (id) { if (S.demo) { go('event', { id }); return; } return _openEvent(id); };
  const _applyVote = applyVote; applyVote = function (ev, p, choices, at, via) {
    if (S.demo) { ev.votes[p.id] = { choices, at: at || Date.now(), via: 'demo' }; if (ev.plan) ev.plan.stale = true; demoSave(); render(); return; }
    return _applyVote(ev, p, choices, at, via);
  };
  const _publish = publish; publish = function (ev) {
    if (S.demo) { ev.plan.savedAt = ev.plan.savedAt || Date.now(); ev.plan.publishedAt = Date.now(); ev.plan.dirty = false; demoSave(); S.present = { evId: ev.id, url: null }; render(); return; }
    return _publish(ev);
  };
  const _inviteCard = inviteCard; inviteCard = function (ev, L, txt) { return S.demo ? demoInviteCard(ev) : _inviteCard(ev, L, txt); };
  const _personRow = personRowActions; personRowActions = function (ev, p, pl) { return S.demo ? '' : _personRow(ev, p, pl); };
  const _replyBox = replyBox; replyBox = function () { return S.demo ? '' : _replyBox(); };
  const _aiReply = aiReply; aiReply = async function () {
    // In the production build the AI only serves real, authenticated sessions; the demo uses the built-in helper.
    if (S.demo && SERVER) { const e = new Error('off'); e.code = 'ai_off'; throw e; }
    return _aiReply();
  };
  const _header = header; header = function () { return _header() + demoBanner(); };
  const _home = VIEWS.home; VIEWS.home = () => (S.demo ? `<div class="banner">${ic('info')}<span>${t('demoHomeTip')}</span></div>` : '') + _home();
  if (SERVER) {
    const _fam = VIEWS.family; VIEWS.family = () => (S.demo ? viewFamily() + `<div class="card" style="margin-top:22px"><h3>${t('familySettings')}</h3><p class="small muted" style="margin:6px 0 12px">${t('demoSettings')}</p><button class="btn gold" data-act="demoOwn">${t('demoOwn')}</button></div>` : _fam());
  }
  Object.assign(A, {
    demoStart() { enterDemo(false); },
    demoReset() { confirmBox(t('demoReset'), t('demoResetBody'), t('demoReset'), () => { try { localStorage.removeItem(DEMO_KEY); } catch (e) {} S.store = makeDemoData(); S.demoLang = S.lang; S.linkCache = {}; S.present = null; demoSave(); go('home'); }); },
    demoExit() { exitDemo(); },
    demoOwn() { exitDemo(() => { if (SERVER) { if (S.family) go('home'); else { S.ui.authMode = 'signup'; S.ui.authMsg = ''; goServer('auth'); } } else { S.draft = newDraft(); go('wizard'); } }); },
  });
  const _lang = A.lang; A.lang = function () { _lang(); if (S.demo) { S.demoLang = S.lang; demoSave(); } };
}
