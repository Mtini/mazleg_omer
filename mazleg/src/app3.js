// ---------- views ----------
function header() {
  const r = S.route.name; const guest = r === 'vote' && S.vote && (S.vote.mode === 'remote' || S.vote.mode === 'server') || r === 'result';
  return `<header class="top"><div class="top-in">
    <button class="brand" data-act="${guest ? 'noop' : 'go'}" data-to="home" aria-label="MAZLEG"><img src="${LOGO}" alt=""><span><b>MAZLEG</b><small>${esc(t('tagline'))}</small></span></button>
    <nav>${guest ? '' : `
      <button class="navbtn" data-act="go" data-to="home" ${r === 'home' ? 'aria-current="page"' : ''}>${ic('table', ' width="18" height="18" style="vertical-align:-4px"')} <span>${t('home')}</span></button>
      <button class="navbtn" data-act="go" data-to="family" ${r === 'family' ? 'aria-current="page"' : ''}>${ic('users', ' width="18" height="18" style="vertical-align:-4px"')} <span>${t('family')}</span></button>`}
      <button class="lang" data-act="lang" aria-label="Language">${t('langSwitch')}</button>
    </nav></div></header>`;
}

function viewHome() {
  const famBar = typeof familyBar === 'function' ? familyBar() : '';
  const evs = [...S.store.events].sort((a, b) => b.createdAt - a.createdAt);
  const fam = S.store.family;
  return `${famBar}
  <section class="hero">
    <div>
      <h1>${t('heroTitle')}</h1>
      <p class="lead">${t('heroLead')}</p>
      <div class="row"><button class="btn gold lg" data-act="newDinner">${ic('plus')} ${t('createDinner')}</button>${S.demo ? '' : `<button class="btn lg" data-act="demoStart">${ic('eye')} ${t('tryDemo')}</button>`}</div>
    </div>
    <div class="mascot" aria-hidden="true"><div class="disc"></div><img src="${LOGO}" alt=""><div class="bubble">${t('mascotHi')}</div></div>
  </section>
  <div class="section-h"><h2>${t('yourDinners')}</h2></div>
  ${evs.length ? `<div class="evlist">${evs.map((ev) => `
    <button class="evrow" data-act="openEvent" data-id="${ev.id}">
      <span class="evicon">${ic('cal', ' width="22" height="22"')}</span>
      <span style="flex:1;min-width:0"><span class="t">${esc(ev.name)}</span><br><span class="small muted">${esc(fmtDate(ev.date) || typeLabel(ev))} · ${t('people', { n: ev.participants.length })} · ${t('votesOf', { a: voteCount(ev), b: ev.participants.length })}</span></span>
      ${statusPill(ev)}
    </button>`).join('')}</div>` : `<div class="empty">${t('noDinners')}</div>`}
  <div class="section-h"><h2>${t('savedFamily')}</h2>${fam.length ? `<button class="btn sm" data-act="go" data-to="family">${t('manage')}</button>` : ''}</div>
  ${fam.length ? `<div class="chips">${fam.slice(0, 24).map((m) => `<span class="chip" style="cursor:default">${av(m, 26)} ${esc(m.name)}</span>`).join('')}${fam.length > 24 ? `<span class="chip">+${fam.length - 24}</span>` : ''}</div>` : `<div class="empty">${t('noFamily')}</div>`}
  <div class="section-h"><h2>${t('how')}</h2></div>
  <div class="steps3">${[1, 2, 3].map((i) => `<div class="s"><div class="n">${i}</div><h3>${t('how' + i + 't')}</h3><p class="muted small" style="margin-top:6px">${t('how' + i)}</p></div>`).join('')}</div>`;
}

// ---------- wizard ----------
const STEPS = ['wDetails', 'wPeople', 'wTables', 'wReview'];
function viewWizard() {
  const d = S.draft;
  const head = `<div class="wz-head" role="list">${STEPS.map((k, i) => `<button role="listitem" class="wz-step ${i < d.step ? 'done' : ''}" data-act="wzGo" data-step="${i}" ${i === d.step ? 'aria-current="step"' : ''}><span class="n">${i < d.step ? '✓' : i + 1}</span>${t(k)}</button>`).join('')}</div>`;
  const body = [wzDetails, wzPeople, wzTables, wzReview][d.step]();
  const last = d.step === 3;
  const foot = `<div class="wz-foot">
    <button class="btn" data-act="${d.step ? 'wzBack' : 'wzCancel'}">${d.step ? ic(flip('back')) + ' ' + t('back') : t('cancel')}</button><span class="spacer"></span>
    ${last ? `<button class="btn gold lg" data-act="wzFinish">${d.editing ? t('saveChanges') : t('createAndInvite')}</button>` : `<button class="btn dark lg" data-act="wzNext">${t('next')} ${ic(flip('fwd'))}</button>`}
  </div>`;
  return `<div class="${d.step === 2 ? '' : 'narrow'}">${head}${body}${foot}</div>`;
}
function wzDetails() {
  const d = S.draft, e = d.errors || {};
  const types = ['friday', 'birthday', 'holiday', 'gathering', 'custom'];
  return `<h2 style="margin-bottom:18px">${t('wDetails')}</h2><div class="card stack">
    <div><label class="f" for="ev-name">${t('evName')}</label><input id="ev-name" class="inp ${e.name ? 'err' : ''}" data-in="dName" value="${esc(d.name)}" placeholder="${esc(t('evNamePh'))}" maxlength="80" autocomplete="off">${e.name ? `<div class="errmsg">${t('needName')}</div>` : ''}</div>
    <div><span class="f" style="display:block;font-weight:600;font-size:.9rem;margin-bottom:8px">${t('evType')}</span><div class="chips">${types.map((x) => `<button class="chip" data-act="dType" data-v="${x}" aria-pressed="${d.type === x}">${t('t_' + x)}</button>`).join('')}</div>
    ${d.type === 'custom' ? `<input class="inp" style="margin-top:10px" data-in="dCustom" value="${esc(d.customType || '')}" placeholder="${esc(t('customType'))}" maxlength="40">` : ''}</div>
    <div class="grid2"><div><label class="f" for="ev-date">${t('evDate')}</label><input id="ev-date" type="date" class="inp" data-in="dDate" value="${esc(d.date)}"></div>
    <div><label class="f" for="ev-count">${t('evCount')}</label><input id="ev-count" type="number" min="2" max="200" inputmode="numeric" class="inp" data-in="dExpected" value="${esc(d.expected || '')}"></div></div>
  </div>`;
}
function wzPeople() {
  const d = S.draft, e = d.errors || {};
  const groups = ['none', 'child', 'teen', 'adult', 'senior'];
  return `<div class="row" style="margin-bottom:14px"><h2>${t('wPeople')}</h2><span class="pill gold">${d.participants.length}</span></div>
  <div class="card">
    <div class="quickadd"><input id="qa-name" class="inp" placeholder="${esc(t('namePh'))}" autocomplete="off" maxlength="60" aria-label="${esc(t('namePh'))}">
    <input id="qa-age" class="inp" type="number" min="0" max="120" inputmode="numeric" placeholder="${esc(t('agePh'))}" aria-label="${esc(t('agePh'))}">
    <button class="btn dark" data-act="qaAdd">${ic('plus')} <span class="hide-sm">${t('addPerson')}</span></button></div>
    <p class="hint">${t('quickHint')}</p>
    <div class="row" style="margin-top:12px"><button class="btn sm" data-act="modal" data-kind="paste">${ic('clip')} ${t('pasteList')}</button>
    <button class="btn sm" data-act="modal" data-kind="famImport">${ic('users')} ${t('fromFamily')}</button></div>
  </div>
  ${e.people ? `<div class="errmsg" style="margin-top:10px">${e.people}</div>` : ''}
  <div class="plist">${d.participants.map((p) => `
    <div class="prow">
      <button class="photo-btn" data-act="photo" data-scope="draft" data-id="${p.id}" aria-label="${esc(t('addPhoto'))}">${av(p, 40)}</button>
      <input class="inp" data-in="pName" data-id="${p.id}" value="${esc(p.name)}" aria-label="${esc(t('namePh'))}" maxlength="60">
      <input class="inp" type="number" min="0" max="120" inputmode="numeric" data-in="pAge" data-id="${p.id}" value="${p.age == null ? '' : p.age}" placeholder="${esc(t('ageUnknown'))}" aria-label="${esc(t('agePh'))}">
      <select class="inp grp" data-in="pGroup" data-id="${p.id}" aria-label="${esc(t('grp'))}">${groups.map((g) => `<option value="${g}" ${p.group === g || (!p.group && g === 'none') ? 'selected' : ''}>${g === 'none' ? t('grp') : t('g_' + g)}</option>`).join('')}</select>
      <button class="btn icon ghost" data-act="pRemove" data-id="${p.id}" aria-label="${esc(t('remove'))} ${esc(p.name)}">${ic('x')}</button>
    </div>`).join('')}</div>`;
}
function wzTables() {
  const d = S.draft; const c = d.cfg; const mode = d.layoutMode;
  const modes = ['connected', 'rect', 'round', 'oval', 'separate', 'custom'];
  const n = d.participants.length, cap = activeSeats(d.layout);
  const stepper = (key, label, min, max) => `<div><span class="f" style="display:block;font-weight:600;font-size:.9rem;margin-bottom:6px">${label}</span><div class="stepper"><button data-act="cfg" data-k="${key}" data-d="-1" aria-label="−">−</button><output>${c[key]}</output><button data-act="cfg" data-k="${key}" data-d="1" aria-label="+">+</button></div></div>`;
  let ctl = '';
  if (mode === 'connected' || mode === 'rect') {
    ctl = `${mode === 'connected' ? stepper('tables', t('nTables')) : ''}${stepper('perSide', t('perSide'))}
      <div><span class="f" style="display:block;font-weight:600;font-size:.9rem;margin-bottom:10px">${t('heads')}</span><span class="switch" role="switch" tabindex="0" aria-checked="${c.heads}" data-act="cfgToggle" data-k="heads"><i></i></span></div>
      <div><span class="f" style="display:block;font-weight:600;font-size:.9rem;margin-bottom:6px">${t('orient')}</span><div class="seg"><button data-act="cfgSet" data-k="orient" data-v="horizontal" aria-pressed="${c.orient !== 'vertical'}">${t('horiz')}</button><button data-act="cfgSet" data-k="orient" data-v="vertical" aria-pressed="${c.orient === 'vertical'}">${t('vert')}</button></div></div>`;
  } else if (mode === 'round' || mode === 'oval') ctl = stepper('seats', t('seatsN'));
  else if (mode === 'separate') ctl = stepper('count', t('nTables')) + stepper('seatsEach', t('seatsEach'));
  const sel = S.ui.sel; let selTools = '';
  if (sel && sel.type === 'table') {
    const tt = d.layout.tables.find((x) => x.id === sel.id);
    if (tt) selTools = `<span class="small muted">${t('addTable')}:</span><button class="btn sm" data-act="tRot">${ic('rot')} ${t('rotate')}</button>
      ${tt.shape === 'rect' ? `<button class="btn sm" data-act="tSize" data-d="1">${t('longer')}</button><button class="btn sm" data-act="tSize" data-d="-1">${t('shorter')}</button><button class="btn sm" data-act="tHead">${t('headSeat')}</button>` : `<button class="btn sm" data-act="tSize" data-d="1">+ ${t('seatsN')}</button><button class="btn sm" data-act="tSize" data-d="-1">− ${t('seatsN')}</button>`}
      <button class="btn sm" data-act="cAdd">${ic('plus')} ${t('addChair')}</button><button class="btn sm danger" data-act="tDel">${ic('trash')} ${t('removeTable')}</button>`;
  } else if (sel && sel.type === 'chair') {
    const ch = d.layout.chairs.find((x) => x.id === sel.id);
    if (ch) selTools = `<button class="btn sm" data-act="cToggle">${ch.disabled ? t('chairOn') : t('chairOff')}</button><button class="btn sm danger" data-act="cDel">${ic('trash')} ${t('removeChair')}</button>`;
  }
  return `<div class="row" style="margin-bottom:14px"><h2>${t('wTables')}</h2><span class="spacer"></span>
    <span class="pill ${cap >= n ? 'ok' : ''}" style="${cap < n ? 'color:var(--danger)' : ''}">${t('capacity', { s: cap, p: n })} · ${cap >= n ? t('capOk') : t('capShort', { n: n - cap })}</span></div>
  <div class="seg" style="margin-bottom:16px">${modes.map((m) => `<button data-act="layoutMode" data-v="${m}" aria-pressed="${mode === m}">${t('lay_' + m)}</button>`).join('')}</div>
  ${mode !== 'custom' ? `<div class="card" style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">${ctl}</div>` : ''}
  <div class="plan-wrap">
    <div class="plan-tools"><b style="font-family:var(--f-display);font-weight:600">${t('designer')}</b>${modeSeg('design')}<span class="spacer"></span>
      ${is3d('design') ? '' : `<button class="btn sm" data-act="tAdd">${ic('plus')} ${t('addTable')}</button>
      <button class="btn sm" data-act="adjToggle" aria-pressed="${S.ui.showAdj}">${ic('link')} ${t('showAdj')}</button>`}</div>
    ${selTools && !is3d('design') ? `<div class="plan-tools" style="background:var(--surface)">${selTools}</div>` : ''}
    ${is3d('design') ? view3d('v3d', { key: 'design', refit: true, layout: d.layout, assign: {}, people: [] })
      : planSVG({ layout: d.layout, mode: 'design', sel: S.ui.sel, showAdj: S.ui.showAdj, rot: shouldRotate(d.layout) }, 'designer')}
  </div>
  <p class="hint">${is3d('design') ? t('v3designHint') : t('designerHint')}</p>
  ${d.errors && d.errors.cap ? `<div class="errmsg">${d.errors.cap}</div>` : ''}`;
}
function wzReview() {
  const d = S.draft; const cap = activeSeats(d.layout);
  const sec = (title, step, inner) => `<div class="card"><div class="row" style="margin-bottom:10px"><h3>${title}</h3><span class="spacer"></span><button class="btn sm ghost" data-act="wzGo" data-step="${step}">${ic('edit')} ${t('edit')}</button></div>${inner}</div>`;
  return `<h2 style="margin-bottom:18px">${t('reviewTitle')}</h2><div class="stack">
  ${sec(t('wDetails'), 0, `<div class="kv"><span class="muted">${t('evName')}</span><b>${esc(d.name)}</b><span class="muted">${t('evType')}</span><span>${esc(d.type === 'custom' ? d.customType || t('t_custom') : t('t_' + d.type))}</span><span class="muted">${t('evDate')}</span><span>${esc(fmtDate(d.date) || '—')}</span></div>`)}
  ${sec(t('wPeople') + ` <span class="pill gold">${d.participants.length}</span>`, 1, `<div class="chips">${d.participants.map((p) => `<span class="chip" style="cursor:default">${av(p, 24)} ${esc(p.name)} <span class="muted small">${p.age != null ? p.age : ''}</span></span>`).join('')}</div>`)}
  ${sec(t('wTables'), 2, `<p class="small muted" style="margin-bottom:10px">${t('tablesSummary', { t: d.layout.tables.length, s: cap })} — <b style="color:${cap >= d.participants.length ? 'var(--ok)' : 'var(--danger)'}">${cap >= d.participants.length ? t('capOk') : t('capShort', { n: d.participants.length - cap })}</b></p><div class="plan-wrap">${planSVG({ layout: d.layout, mode: 'design', rot: shouldRotate(d.layout) }, 'review-plan')}</div>`)}
  <label class="switch" role="switch" tabindex="0" aria-checked="${d.saveFamily}" data-act="toggleSaveFam"><i></i><span>${t('saveToFamily')}</span></label>
  </div>`;
}
