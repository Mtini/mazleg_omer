// ---------- organizer dashboard ----------
function viewEvent() {
  const ev = evById(S.route.id); if (!ev) return `<div class="empty">${t('notFound')}</div>`;
  const n = ev.participants.length, v = voteCount(ev), pct = n ? Math.round(v / n * 100) : 0;
  const L = S.linkCache[ev.id] || {};
  const inviteText = t('waInvite', { x: ev.name });
  const rules = ev.rules || [];
  return `
  <button class="btn ghost sm" data-act="go" data-to="home">${ic(flip('back'))} ${t('home')}</button>
  <div class="row" style="margin:10px 0 6px"><h2 style="font-size:2rem">${esc(ev.name)}</h2>${statusPill(ev)}</div>
  <p class="muted" style="margin-bottom:18px">${esc(typeLabel(ev))}${ev.date ? ' · ' + esc(fmtDate(ev.date)) : ''} · ${t('people', { n })} · ${t('tablesSummary', { t: ev.layout.tables.length, s: activeSeats(ev.layout) })}</p>
  <div class="dash">
    <div class="stack">
      ${inviteCard(ev, L, inviteText)}
      <div class="card">
        <div class="row"><h3>${t('progress')}</h3><span class="spacer"></span><span class="big-n">${v}<span class="muted" style="font-size:1.1rem">/${n}</span></span></div>
        <div class="bar" style="margin:12px 0 6px"><i style="width:${pct}%"></i></div>
        <p class="small ${v === n ? '' : 'muted'}" style="margin-bottom:12px">${v === n && n ? '<b>' + t('allDone') + '</b>' : t('votesOf', { a: v, b: n })}</p>
        <div class="who">${ev.participants.map((p) => {
          const pl = L.personal && L.personal[p.id];
          return `<div class="r">${av(p, 34)}<span style="flex:1;min-width:0;font-weight:500">${esc(p.name)}</span>
          ${ev.votes[p.id] ? `<span class="pill ok">${ic('check', ' width="13" height="13"')} ${t('submitted')}</span>` : `<span class="pill">${t('pending')}</span>`}
          ${personRowActions(ev, p, pl)}</div>`;
        }).join('')}</div>
        <p class="hint">${t('personalHint')}</p>
      </div>
    </div>
    <div class="stack">
      <div class="card">
        <h3>${ev.plan && ev.plan.assignment ? t('generated') : t('notGenerated')}</h3>
        ${ev.plan && ev.plan.current ? `<p class="muted small" style="margin:6px 0 0">${t('satisfaction')}: <b>${ev.plan.current.stats.satisfaction}%</b> · ${t('fulfilled')}: ${ev.plan.current.stats.fulfilled}/${ev.plan.current.stats.total}</p>` : ''}
        <div class="row" style="margin-top:14px">
          ${ev.plan && ev.plan.assignment ? `<button class="btn gold" data-act="openSeating">${ic('table')} ${t('viewSeating')}</button><button class="btn" data-act="generate">${ic('refresh')} ${t('regenerateSeat')}</button>` : `<button class="btn gold lg" data-act="generate">${ic('spark')} ${t('generate')}</button>`}
        </div>
      </div>
      <div class="card">
        <h3>${t('voteHere')}</h3><p class="muted small" style="margin:6px 0 12px">${t('voteHereHint')}</p>
        <button class="btn" data-act="voteLocal" ${ev.votingOpen ? '' : 'disabled'}>${ic('phone')} ${t('voteHere')}</button>
        ${replyBox()}
        <hr style="border:0;border-top:1px solid var(--line-2);margin:18px 0">
        <div class="row"><span class="small ${ev.votingOpen ? '' : 'muted'}" style="flex:1">${ev.votingOpen ? t('st_voting') : t('votingClosed')}</span>
        <button class="btn sm" data-act="toggleVoting">${ev.votingOpen ? ic('lock') + ' ' + t('closeVoting') : ic('unlock') + ' ' + t('reopenVoting')}</button></div>
      </div>
      <div class="card">
        <div class="row"><h3>${t('rules')}</h3><span class="spacer"></span><button class="btn sm" data-act="modal" data-kind="rule">${ic('plus')} ${t('addRule')}</button></div>
        <p class="muted small" style="margin:6px 0 10px">${t('rulesHint')}</p>
        ${rules.length ? rules.map((r, i) => `<div class="row" style="padding:6px 0"><span class="pill ${r.kind === 'together' ? 'gold' : ''}">${t(r.kind)}</span><span style="flex:1">${esc((pById(ev, r.a) || {}).name)} · ${esc((pById(ev, r.b) || {}).name)}</span><button class="btn icon ghost" data-act="ruleDel" data-i="${i}" aria-label="${t('remove')}">${ic('x')}</button></div>`).join('') : `<p class="small muted">${t('noRules')}</p>`}
      </div>
      <div class="row"><button class="btn sm" data-act="editSetup">${ic('edit')} ${t('editSetup')}</button><button class="btn sm danger" data-act="delEvent">${ic('trash')} ${t('deleteEvent')}</button></div>
    </div>
  </div>`;
}

// ---------- voting (participant) ----------
function viewVote() {
  const V = S.vote; const ev = V.ev;
  const top = `<div class="vote-head"><img src="${LOGO}" alt=""><h2 style="margin-top:8px">${esc(ev.name)}</h2>${ev.date ? `<p class="muted small">${esc(fmtDate(ev.date))}</p>` : ''}</div>`;
  if (V.closed) return `<div class="narrow">${top}<div class="empty">${t('votingClosedP')}</div></div>`;
  if (V.step === 'who') {
    return `<div class="narrow">${top}<h2 style="text-align:center">${t('whoAreYou')}</h2><p class="muted" style="text-align:center;margin:6px 0 16px">${t('whoHint')}</p>
      ${ev.participants.length > 10 ? `<input class="inp" data-filter="who" placeholder="${esc(t('search'))}" style="margin-bottom:12px" aria-label="${esc(t('search'))}">` : ''}
      <div class="names" id="who">${ev.participants.map((p) => `<button class="name-card" data-act="voteMe" data-id="${p.id}" data-name="${esc(p.name.toLowerCase())}">${av(p, 36)}<span>${esc(p.name)}</span>${V.mode === 'local' && V.full.votes[p.id] ? `<span class="ck" style="background:var(--ok-soft);border-color:transparent;color:var(--ok)">${ic('check', ' width="14" height="14"')}</span>` : ''}</button>`).join('')}</div>
      ${V.mode === 'local' ? `<div style="margin-top:20px;text-align:center"><button class="btn ghost" data-act="voteExit">${ic(flip('back'))} ${t('back')}</button></div>` : ''}</div>`;
  }
  const me = ev.participants.find((p) => p.id === V.me);
  if (V.step === 'done') {
    const names = V.draft.map((id) => (ev.participants.find((p) => p.id === id) || {}).name).filter(Boolean);
    return `<div class="narrow"><div class="done-hero"><img src="${LOGO}" alt=""><h2 style="margin-top:14px">${t('thanks', { x: esc(me.name) })}</h2>
      <p class="muted" style="margin-top:8px">${t('youChose')} <b>${names.length ? esc(names.join(', ')) : t('noPref')}</b></p></div>
      ${V.mode === 'server' ? `<div class="card" style="text-align:center"><span class="pill ok">${ic('check', ' width="13" height="13"')} ${t('sentServer')}</span><p class="muted small" style="margin-top:10px">${t('confirmB')}</p></div>
        <div class="row" style="justify-content:center;margin-top:14px"><button class="btn ghost" data-act="voteEdit">${ic('edit')} ${t('changeChoice')}</button>${V.ev.published ? `<button class="btn gold" data-act="openPublished">${ic('table')} ${t('viewSeating')}</button>` : ''}</div>`
      : V.mode === 'remote' ? `<div class="card" style="text-align:center"><h3>${t('sendToOrg')}</h3><p class="muted small" style="margin:6px 0 16px">${t('sendToOrgHint')}</p>
        <a class="btn gold lg" style="width:100%" href="${esc(waHref(t('waReply', { x: ev.name }) + '\n' + (V.replyUrl || '')))}" target="_blank" rel="noopener">${ic('msg')} ${t('sendWA')}</a>
        <div class="row" style="justify-content:center;margin-top:10px"><button class="btn sm" data-act="copy" data-v="${esc(V.replyUrl || '')}">${ic('copy')} ${t('copyReply')}</button><button class="btn sm" data-act="share" data-title="${esc(ev.name)}" data-text="${esc(t('waReply', { x: ev.name }))}" data-url="${esc(V.replyUrl || '')}">${ic('share')} ${t('share')}</button></div></div>
        <div style="text-align:center;margin-top:14px"><button class="btn ghost" data-act="voteEdit">${ic('edit')} ${t('changeChoice')}</button></div>`
      : `<div class="card" style="text-align:center"><p>${t('thanksSaved')}</p><div class="row" style="justify-content:center;margin-top:14px"><button class="btn gold" data-act="voteNext">${t('nextPerson')} ${ic(flip('fwd'))}</button><button class="btn" data-act="voteExit">${t('done')}</button></div></div>`}
    </div>`;
  }
  // pick
  const others = ev.participants.filter((p) => p.id !== V.me);
  const slot = (i) => { const id = V.draft[i]; const p = id && ev.participants.find((x) => x.id === id); return p ? `<div class="slot full">${av(p, 36)}<b style="flex:1">${esc(p.name)}</b><button class="btn icon ghost" data-act="votePick" data-id="${p.id}" aria-label="${t('remove')} ${esc(p.name)}">${ic('x')}</button></div>` : `<div class="slot">${ic('chair', ' width="22" height="22"')} ${t('slotEmpty', { n: i + 1 })}</div>`; };
  return `<div class="narrow">${top}
    <h2>${t('hello', { x: esc(me.name) })}</h2><p class="muted" style="margin:6px 0 4px">${t('pickLead')}</p>
    ${V.prev ? `<div class="banner" style="margin-top:12px">${ic('info')}<span style="flex:1">${t('prevSuggest', { x: esc(V.prev.names.join(', ')) })}</span><button class="btn sm" data-act="usePrev">${t('useIt')}</button></div>` : ''}
    <div class="slots">${slot(0)}${slot(1)}</div>
    <div class="row" style="margin-bottom:12px"><input class="inp" style="flex:1" data-filter="pick" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}">
      <button class="btn" data-act="chatOpen" data-ctx="voter">${'<img src="' + LOGO + '" alt="" style="height:20px">'} ${t('askMazleg')}</button></div>
    <div class="names" id="pick">${others.map((p) => { const on = V.draft.includes(p.id); return `<button class="name-card" data-act="votePick" data-id="${p.id}" data-name="${esc(p.name.toLowerCase())}" aria-pressed="${on}">${av(p, 36)}<span>${esc(p.name)}</span><span class="ck">${on ? ic('check', ' width="14" height="14"') : ''}</span></button>`; }).join('')}</div>
    <div class="sticky-cta"><button class="btn ${V.draft.length ? 'gold' : 'dark'} lg" style="width:100%" data-act="voteSubmit">${V.draft.length ? (V.had ? t('update') : t('submit')) : t('submitNone')}</button>
    <div style="text-align:center;margin-top:6px"><button class="btn ghost sm" data-act="voteNotMe">${t('notMe')}</button></div></div>
  </div>`;
}

// ---------- seating editor ----------
function viewSeating() {
  const ev = evById(S.route.id); if (!ev || !ev.plan) return `<div class="empty">${t('notFound')}</div>`;
  const pl = ev.plan; const cur = pl.current; const st = cur.stats;
  const nameOf = (id) => esc((pById(ev, id) || {}).name || '?');
  const notes = [];
  if (st.fulfilled < st.total) notes.push(t('cUnmet', { n: st.total - st.fulfilled }));
  for (const [pid, x] of Object.entries(cur.perPerson || {})) if (x.fulfilled === 0) notes.push(t('cNone', { x: nameOf(pid) }));
  const ones = Object.entries(cur.perPerson || {}).filter(([, x]) => x.requested === 2 && x.fulfilled === 1).map(([pid]) => nameOf(pid));
  if (ones.length) notes.push(t('cOne', { x: ones.join(', ') }));
  for (const [a, b] of cur.unmetMutual || []) notes.push(t('cMutual', { a: nameOf(a), b: nameOf(b) }));
  for (const v of cur.violations || []) notes.push(t(v.kind === 'together' ? 'cTogether' : 'cApart', { a: nameOf(v.a), b: nameOf(v.b) }));
  const sel = S.ui.chairSel; let selPanel = '';
  if (sel) {
    const pid = Object.keys(pl.assignment).find((k) => pl.assignment[k] === sel); const p = pid && pById(ev, pid);
    const nb = pid ? E.neighbors(ev.layout, pl.assignment, pid) : { beside: [], across: [] };
    const isLocked = (pl.locked || []).includes(sel);
    selPanel = `<div class="card" style="margin-top:14px"><div class="row">${p ? av(p, 44) : `<span class="av" style="--s:44px">·</span>`}<div style="flex:1"><b>${p ? esc(p.name) : t('emptySeat')}</b>
      ${p ? `<div class="small muted">${sidesText(ev, pl.assignment, pid)}</div>` : ''}</div>
      ${p ? `<button class="btn sm" data-act="lockSeat">${ic(isLocked ? 'unlock' : 'lock')} ${isLocked ? t('unlockSeat') : t('lockSeat')}</button>` : ''}</div>
      ${p && !isLocked ? `<div class="row" style="margin-top:12px"><label class="small muted" for="swap">${S.lang === 'he' ? 'החלפה עם' : 'Swap with'}</label><select id="swap" class="inp" style="flex:1" data-in="swapWith"><option value="">—</option>${ev.participants.filter((x) => x.id !== pid).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>` : ''}
    </div>`;
  }
  const opts = pl.options || [];
  return `
  <button class="btn ghost sm" data-act="openEvent" data-id="${ev.id}">${ic(flip('back'))} ${esc(ev.name)}</button>
  <div class="row" style="margin:10px 0 16px"><h2 style="font-size:2rem">${t('seatingTitle')}</h2>${statusPill(ev)}${pl.dirty ? `<span class="pill">${t('unsaved')}</span>` : ''}</div>
  ${pl.stale ? `<div class="banner">${ic('info')}<span style="flex:1">${S.lang === 'he' ? 'התקבלו בחירות חדשות מאז הסידור הזה.' : 'New choices arrived since this plan was made.'}</span><button class="btn sm" data-act="generate">${ic('refresh')} ${t('regenerateSeat')}</button></div>` : ''}
  <div class="seat-layout">
    <div>
      <div class="row" style="margin-bottom:10px">${modeSeg('seat')}<span class="spacer"></span>
        <select class="inp" style="max-width:230px;min-height:40px" data-in="seatFind" aria-label="${esc(t('findPerson'))}"><option value="">${t('findPerson')}</option>${ev.participants.map((p) => `<option value="${p.id}" ${pl.assignment[p.id] === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      ${is3d('seat') ? view3d('v3d', { key: 'seat-' + ev.id, layout: ev.layout, assign: pl.assignment, people: ev.participants, sel, highlight: neighborChairs(ev.layout, sel) }, { onPick: (id) => { S.ui.chairSel = id; render(); } })
        : `<div class="plan-wrap">${planSVG(seatOpts(ev, { rot: shouldRotate(ev.layout) }), 'seatplan')}</div>`}
      <p class="hint">${is3d('seat') ? t('v3seatHint') : t('dragHint')}</p>
      ${selPanel}
    </div>
    <div class="stack">
      <div class="card"><div class="score"><div class="ring" style="--p:${st.satisfaction}"><b>${st.satisfaction}%</b></div>
        <div class="kv" style="flex:1"><span>${t('fulfilled')}</span><b>${st.fulfilled}/${st.total}</b><span>${t('mutualMet')}</span><b>${st.mutualMet}/${st.mutualPairs}</b><span>${t('withNone')}</span><b>${st.votersWithNone}</b></div></div>
        <p class="tiny muted" style="margin-top:10px">${t('satisfaction')} · score ${cur.score}</p></div>
      ${opts.length > 1 ? `<div class="card"><h3 style="margin-bottom:10px">${t('options')}</h3><div class="tabs">${opts.map((o, i) => `<button class="tab" data-act="pickOption" data-i="${i}" aria-pressed="${!pl.manual && pl.active === i}"><b>${o.stats.satisfaction}%</b><span class="tiny muted">${t('optionN', { n: i + 1 })}</span></button>`).join('')}${pl.manual ? `<span class="tab" aria-pressed="true"><b>${st.satisfaction}%</b><span class="tiny muted">${t('manual')}</span></span>` : ''}</div></div>` : ''}
      <div class="card"><h3 style="margin-bottom:10px">${t('compromises')}</h3>
        ${notes.length ? `<div class="notes">${notes.slice(0, 8).map((x) => `<div class="note">${ic('info')}<span>${x}</span></div>`).join('')}${notes.length > 8 ? `<p class="tiny muted">+${notes.length - 8}</p>` : ''}</div><p class="tiny muted" style="margin-top:10px">${t('whyCompromise')}</p>` : `<p class="small">${t('allHappy')}</p>`}
      </div>
      <div class="stack">
        <button class="btn" style="width:100%" data-act="present">${ic('spark')} ${t('presentBtn')}</button>
        <button class="btn" style="width:100%" data-act="chatOpen" data-ctx="organizer"><img src="${LOGO}" alt="" style="height:20px"> ${t('askAboutPlan')}</button>
        <div class="row"><button class="btn" style="flex:1" data-act="generate">${ic('refresh')} ${t('regenerateSeat')}</button><button class="btn dark" style="flex:1" data-act="savePlan">${ic('save')} ${t('saveArr')}</button></div>
        <button class="btn gold lg" style="width:100%" data-act="publish">${ic('send')} ${t('publish')}</button>
      </div>
    </div>
  </div>`;
}

// ---------- published result (participant) ----------
function viewResult() {
  const R = S.remote; const ev = R.ev;
  const me = S.ui.findMe; const meChair = me && R.assign[me];
  let info = '';
  if (me) {
    info = `<div class="card" style="margin-top:14px;text-align:center"><span class="pill gold">${t('yourSeat')}</span><p style="margin-top:10px" class="small">${sidesText(ev, R.assign, me)}</p></div>`;
  }
  return `<div class="narrow"><div class="vote-head"><img src="${LOGO}" alt=""><h2 style="margin-top:8px">${esc(ev.name)}</h2>${ev.date ? `<p class="muted small">${esc(fmtDate(ev.date))}</p>` : ''}</div>
    <label class="f" for="findme">${t('findSeat')}</label>
    <select id="findme" class="inp" data-in="findMe" style="margin-bottom:14px"><option value="">—</option>${ev.participants.map((p) => `<option value="${p.id}" ${me === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <div style="margin-bottom:10px">${modeSeg('result')}</div>
    ${is3d('result') ? view3d('v3d', { key: 'result', layout: ev.layout, assign: R.assign, people: ev.participants, me, dim: !!me, highlight: neighborChairs(ev.layout, meChair), introDone: !!S.ui.resultIntro, intro: (v) => { S.ui.resultIntro = true; v.intro(); } },
        { onPick: (id) => { const pid = Object.keys(R.assign).find((k) => R.assign[k] === id); if (pid) { S.ui.findMe = pid; render(); } } })
      : `<div class="plan-wrap">${planSVG({ layout: ev.layout, mode: 'view', assign: R.assign, people: ev.participants, me, dim: !!me, highlight: neighborChairs(ev.layout, meChair), rot: shouldRotate(ev.layout) }, 'resultplan')}</div>`}
    ${info}</div>`;
}

// ---------- family ----------
function viewFamily() {
  const fam = S.store.family; const evs = [...S.store.events].sort((a, b) => b.createdAt - a.createdAt);
  return `<div class="narrow"><h2 style="font-size:2rem">${t('familyTitle')}</h2><p class="muted" style="margin:8px 0 20px">${t('familyLead')}</p>
    <button class="btn" data-act="famAdd">${ic('plus')} ${t('addMember')}</button>
    ${fam.length ? `<div class="plist">${fam.map((m) => `<div class="prow" style="grid-template-columns:auto 1fr 84px auto">
      <button class="photo-btn" data-act="photo" data-scope="family" data-id="${m.id}" aria-label="${esc(t('addPhoto'))}">${av(m, 40)}</button>
      <input class="inp" data-in="fName" data-id="${m.id}" value="${esc(m.name)}" maxlength="60" aria-label="${esc(t('namePh'))}">
      <input class="inp" type="number" min="0" max="120" data-in="fAge" data-id="${m.id}" value="${m.age == null ? '' : m.age}" placeholder="${esc(t('ageUnknown'))}" aria-label="${esc(t('agePh'))}">
      <button class="btn icon ghost" data-act="famDel" data-id="${m.id}" aria-label="${t('del')} ${esc(m.name)}">${ic('trash')}</button></div>`).join('')}</div>` : `<div class="empty" style="margin-top:14px">${t('noFamily')}</div>`}
    <div class="section-h"><h2>${t('pastEvents')}</h2></div>
    ${evs.length ? `<div class="evlist">${evs.map((ev) => `<button class="evrow" data-act="${ev.plan && ev.plan.assignment ? 'openSeatingOf' : 'openEvent'}" data-id="${ev.id}"><span class="evicon">${ic('table', ' width="22" height="22"')}</span><span style="flex:1"><span class="t">${esc(ev.name)}</span><br><span class="small muted">${esc(fmtDate(ev.date) || typeLabel(ev))}</span></span>${statusPill(ev)}</button>`).join('')}</div>` : `<div class="empty">${t('noDinners')}</div>`}
  </div>`;
}

// ---------- modals ----------
function viewModal() {
  const M = S.modal; if (!M) return '';
  const shell = (title, body, foot, extraHead) => `<div class="scrim" data-act="scrim"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h">${extraHead || ''}<h3 style="flex:1">${title}</h3><button class="btn icon ghost" data-act="modalClose" aria-label="${t('close')}">${ic('x')}</button></div>${body}${foot || ''}</div></div>`;
  if (M.kind === 'paste') return shell(t('pasteList'), `<div class="modal-b"><textarea id="paste-ta" class="inp" rows="10" placeholder="${esc(S.lang === 'he' ? 'סבתא רחל, 82\nנועם, 29\nאופיר' : 'Grandma Rachel, 82\nNoam, 29\nOfir')}"></textarea><p class="hint">${t('pasteHint')}</p></div>`, `<div class="modal-f"><button class="btn" data-act="modalClose">${t('cancel')}</button><button class="btn dark" data-act="pasteAdd">${t('addAll')}</button></div>`);
  if (M.kind === 'famImport') {
    const have = new Set(S.draft.participants.map((p) => p.familyId).filter(Boolean));
    const list = S.store.family.filter((m) => !have.has(m.id));
    return shell(t('fromFamily'), `<div class="modal-b">${list.length ? `<div class="names">${list.map((m) => `<button class="name-card" data-act="famPick" data-id="${m.id}" aria-pressed="${(M.picked || []).includes(m.id)}">${av(m, 34)}<span>${esc(m.name)}</span><span class="ck">${(M.picked || []).includes(m.id) ? ic('check', ' width="14" height="14"') : ''}</span></button>`).join('')}</div>` : `<div class="empty">${t('noSaved')}</div>`}</div>`, list.length ? `<div class="modal-f"><button class="btn" data-act="famPickAll">${S.lang === 'he' ? 'סימון הכל' : 'Select all'}</button><span class="spacer"></span><button class="btn dark" data-act="famImportGo">${t('importSel')} (${(M.picked || []).length})</button></div>` : '');
  }
  if (M.kind === 'confirm') return shell(M.title, `<div class="modal-b"><p>${M.body || ''}</p></div>`, `<div class="modal-f"><button class="btn" data-act="modalClose">${t('cancel')}</button><button class="btn ${M.danger ? 'danger' : 'gold'}" data-act="confirmOk">${M.ok}</button></div>`);
  if (M.kind === 'rule') {
    const ev = evById(S.route.id); const opt = ev.participants.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    return shell(t('addRule'), `<div class="modal-b stack"><div class="seg"><button data-act="ruleKind" data-v="together" aria-pressed="${M.rk !== 'apart'}">${t('together')}</button><button data-act="ruleKind" data-v="apart" aria-pressed="${M.rk === 'apart'}">${t('apart')}</button></div>
      <select id="rule-a" class="inp"><option value="">${t('pickTwo')}</option>${opt}</select><select id="rule-b" class="inp"><option value="">${t('pickTwo')}</option>${opt}</select></div>`, `<div class="modal-f"><button class="btn" data-act="modalClose">${t('cancel')}</button><button class="btn dark" data-act="ruleAdd">${t('addRule')}</button></div>`);
  }
  if (M.kind === 'publish') return shell(t('published'), `<div class="modal-b"><p class="muted" style="margin-bottom:14px">${t('publishLead')}</p><div class="linkbox"><input class="inp" readonly value="${esc(M.url)}" data-act="selectAll"><button class="btn dark" data-act="copy" data-v="${esc(M.url)}">${ic('copy')} ${t('copy')}</button></div>
    <div class="row" style="margin-top:12px"><a class="btn gold" href="${esc(waHref(t('waResult', { x: M.name }) + '\n' + M.url))}" target="_blank" rel="noopener">${ic('msg')} ${t('whatsapp')}</a><button class="btn" data-act="share" data-title="${esc(M.name)}" data-text="${esc(t('waResult', { x: M.name }))}" data-url="${esc(M.url)}">${ic('share')} ${t('share')}</button></div></div>`);
  if (M.kind === 'chat') return viewChat(shell);
  return '';
}
function viewChat(shell) {
  const C = S.chat; const real = !!S.sample && !C.demoForced;
  const head = `<span class="bot-av" style="width:40px;height:40px"><img src="${LOGO}" alt="" style="height:32px"></span>`;
  const title = `${t('aiTitle')} <span class="pill ${real ? 'gold' : ''}" style="vertical-align:3px">${real ? t('aiReal') : t('aiDemo')}</span>`;
  const msgs = C.msgs.map((m, i) => `<div class="msg ${m.role === 'me' ? 'me' : 'bot'}">${m.role === 'me' ? '' : `<span class="bot-av"><img src="${LOGO}" alt=""></span>`}<div><div class="bub">${esc(m.text)}</div>
    ${m.actions && m.actions.length ? `<div class="msg-actions">${m.actions.map((a, j) => `<button class="btn sm ${a.done ? '' : 'gold'}" data-act="chatAction" data-m="${i}" data-a="${j}" ${a.done ? 'disabled' : ''}>${a.done ? ic('check') + ' ' + t('selected') : esc(a.label)}</button>`).join('')}</div>` : ''}</div></div>`).join('');
  const typing = C.typing ? `<div class="msg bot"><span class="bot-av"><img src="${LOGO}" alt=""></span><div class="bub typing" aria-label="typing"><span></span><span></span><span></span></div></div>` : '';
  const sugg = C.ctx === 'voter' ? [t('aiS1'), t('aiS2'), t('aiS3'), t('aiS4')] : [t('aiOS1'), t('aiOS2'), t('aiOS3')];
  const body = `<div class="modal-b" id="chat-scroll">${real ? '' : `<p class="tiny muted" style="text-align:center;margin-bottom:10px">${t('aiDemoNote')}</p>`}<div class="chat">${msgs}${typing}</div>
    ${!C.typing ? `<div class="chips" style="margin-top:14px">${sugg.map((s) => `<button class="chip" data-act="chatSugg" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>
    ${C.ctx === 'voter' && S.vote ? `<div style="padding:0 18px 8px" class="small muted">${t('youChose')} <b>${S.vote.draft.length ? esc(S.vote.draft.map((id) => (S.vote.ev.participants.find((p) => p.id === id) || {}).name).join(', ')) : '—'}</b></div>` : ''}
    <div class="chat-in"><input id="chat-in" class="inp" placeholder="${esc(t('aiPh'))}" data-in="chatText" value="${esc(C.input || '')}" autocomplete="off" ${C.typing ? 'disabled' : ''}><button class="btn dark icon" data-act="chatSend" aria-label="${t('send')}" ${C.typing ? 'disabled' : ''}>${ic('send')}</button></div>`;
  return shell(title, body, '', head);
}

// ---------- seams (device-only prototype versions; the server build replaces them) ----------
function inviteCard(ev, L, inviteText) {
  return `<div class="card">
        <h3>${t('invite')}</h3><p class="muted small" style="margin:6px 0 14px">${t('inviteLead')}</p>
        <div class="linkbox"><input class="inp" readonly value="${esc(L.invite || '…')}" aria-label="invite link" data-act="selectAll"><button class="btn dark" data-act="copy" data-v="${esc(L.invite || '')}">${ic('copy')} ${t('copy')}</button></div>
        <div class="row" style="margin-top:10px">
          <a class="btn" href="${esc(waHref(inviteText + '\n' + (L.invite || '')))}" target="_blank" rel="noopener">${ic('msg')} ${t('whatsapp')}</a>
          <button class="btn" data-act="share" data-title="${esc(ev.name)}" data-text="${esc(inviteText)}" data-url="${esc(L.invite || '')}">${ic('share')} ${t('share')}</button>
        </div>
        <details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">${t('howLinksWork')}</summary>
          <p class="small muted" style="margin:8px 0 12px">${t('howLinksBody')}</p>
          <label class="f small" for="baseurl">${t('baseUrlLabel')}</label><input id="baseurl" class="inp" style="direction:ltr;font-size:.82rem" data-in="baseUrl" value="${esc(linkBase())}"><p class="hint">${t('baseUrlHint')}</p>
        </details>
      </div>`;
}
function personRowActions(ev, p, pl) {
  return pl ? `<a class="btn icon ghost" href="${esc(waHref(t('waInvite', { x: ev.name }) + '\n' + pl))}" target="_blank" rel="noopener" aria-label="${t('whatsapp')} ${esc(p.name)}">${ic('msg')}</a><button class="btn icon ghost" data-act="copy" data-v="${esc(pl)}" aria-label="${t('copy')} ${esc(p.name)}">${ic('link')}</button>` : '';
}
function replyBox() {
  return `<hr style="border:0;border-top:1px solid var(--line-2);margin:18px 0">
        <p class="small" style="margin-bottom:8px">${t('replyPaste')}</p>
        <div class="linkbox"><input id="reply-in" class="inp" placeholder="${esc(t('replyPh'))}"><button class="btn" data-act="importReply">${t('importReply')}</button></div>`;
}
