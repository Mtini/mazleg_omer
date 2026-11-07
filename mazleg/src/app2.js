// ---------- seating plan renderer (shared by designer, seating editor, result view) ----------
function shouldRotate(layout) {
  if (!layout || !layout.chairs.length) return false;
  const xs = layout.chairs.map((c) => c.x), ys = layout.chairs.map((c) => c.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return window.innerWidth < 700 && w > h * 1.3;
}
function planView(o) {
  const L = o.layout, rot = o.rot;
  const P = rot ? (x, y) => [-y, x] : (x, y) => [x, y];
  const tById = new Map(L.tables.map((t) => [t.id, t]));
  const seatMode = o.mode !== 'design';
  const R = seatMode ? 25 : 19;
  // bounds
  if (!o.vb) {
    const pts = [];
    L.chairs.forEach((c) => pts.push(P(c.x, c.y)));
    L.tables.forEach((t) => { for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const w = E.toWorld(t, a * t.w / 2, b * t.h / 2); pts.push(P(w[0], w[1])); } });
    if (!pts.length) pts.push([0, 0]);
    const pad = seatMode ? 78 : 48;
    const x0 = Math.min(...pts.map((p) => p[0])) - pad, y0 = Math.min(...pts.map((p) => p[1])) - pad;
    const x1 = Math.max(...pts.map((p) => p[0])) + pad, y1 = Math.max(...pts.map((p) => p[1])) + pad;
    o.vb = [x0, y0, Math.max(240, x1 - x0), Math.max(200, y1 - y0)];
  }
  let s = '';
  s += '<defs>' + (o.people || []).filter((p) => p.photo).map((p) => `<clipPath id="cp-${p.id}"><circle r="${R - 2}"/></clipPath>`).join('') + '</defs>';
  for (const t of L.tables) {
    const [cx, cy] = P(t.x, t.y); const r = (t.rot || 0) + (rot ? 90 : 0);
    const sel = o.sel && o.sel.type === 'table' && o.sel.id === t.id ? ' sel' : '';
    s += `<g data-table="${t.id}" transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${r})" style="cursor:${o.mode === 'design' ? 'move' : 'default'}">` +
      (t.shape === 'rect' ? `<rect class="tbl${sel}" x="${-t.w / 2}" y="${-t.h / 2}" width="${t.w}" height="${t.h}" rx="12"/>` : `<ellipse class="tbl${sel}" rx="${t.w / 2}" ry="${t.h / 2}"/>`) + '</g>';
  }
  if (o.showAdj) {
    const { adj } = E.computeAdjacency(L); const done = new Set(); const cById = new Map(L.chairs.map((c) => [c.id, c]));
    adj.forEach((set, a) => set.forEach((b) => { const k = a < b ? a + b : b + a; if (done.has(k)) return; done.add(k); const A = P(cById.get(a).x, cById.get(a).y), B = P(cById.get(b).x, cById.get(b).y); s += `<line class="adjl" x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}"/>`; }));
  }
  const byChair = {}; if (o.assign) for (const [pid, cid] of Object.entries(o.assign)) byChair[cid] = pid;
  const pMap = new Map((o.people || []).map((p) => [p.id, p]));
  const hlSet = new Set(o.highlight || []);
  let n = 0;
  for (const c of L.chairs) {
    const [x, y] = P(c.x, c.y);
    const pid = byChair[c.id], p = pid && pMap.get(pid);
    const cls = ['chair'];
    if (c.disabled) cls.push('off'); else if (p || o.mode === 'design') cls.push('on');
    if (o.sel && o.sel.type === 'chair' && o.sel.id === c.id) cls.push('sel');
    if (o.me && pid === o.me) cls.push('me');
    if (hlSet.has(c.id)) cls.push('hl');
    if (o.dim && pid !== o.me && !hlSet.has(c.id)) cls.push('dim');
    if (o.ghost && o.ghost.from === c.id) cls.push('dim');
    if (!c.disabled) n++;
    let inner = `<circle class="base" r="${R}"/>`;
    if (o.mode === 'design') {
      inner += c.disabled ? `<path d="M-6 -6L6 6M6 -6L-6 6" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"/>` : `<text text-anchor="middle" dy="4">${n}</text>`;
    } else if (p) {
      inner += p.photo ? `<image href="${esc(p.photo)}" x="${-R + 2}" y="${-R + 2}" width="${2 * R - 4}" height="${2 * R - 4}" clip-path="url(#cp-${p.id})" preserveAspectRatio="xMidYMid slice"/>` : `<text class="ini" text-anchor="middle" dy="5">${esc(initials(p.name))}</text>`;
    }
    if (o.locked && o.locked.includes(c.id)) inner += `<g transform="translate(${R - 5} ${-R + 5})"><circle r="9" fill="var(--ink)"/><path d="M-3.5 0h7v4.5h-7zM-2 0v-2a2 2 0 0 1 4 0v2" fill="none" stroke="var(--bg)" stroke-width="1.6"/></g>`;
    s += `<g class="${cls.join(' ')}" data-chair="${c.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" tabindex="-1">${inner}</g>`;
    if (seatMode && p) {
      const tb = tById.get(c.tableId); const f = E.facing(c, tb) + Math.PI;
      let dx = Math.cos(f), dy = Math.sin(f); if (rot) [dx, dy] = [-dy, dx];
      const lx = x + dx * (R + 9), ly = y + dy * (R + 9) + (Math.abs(dy) > 0.6 ? (dy > 0 ? 10 : -2) : 4);
      const rtl = /[\u0590-\u05FF]/.test(p.name);
      const anchor = Math.abs(dx) > 0.6 ? ((dx > 0) !== rtl ? 'start' : 'end') : 'middle';
      s += `<text class="nm" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" direction="${rtl ? 'rtl' : 'ltr'}">${esc(shortName(p.name))}</text>`;
    }
  }
  if (o.ghost) {
    const p = pMap.get(o.ghost.pid);
    s += `<g transform="translate(${o.ghost.x} ${o.ghost.y})" style="pointer-events:none"><circle r="${R + 3}" fill="var(--gold)" opacity=".9"/><text class="ini" text-anchor="middle" dy="5" style="fill:#1A1918">${esc(initials(p && p.name))}</text></g>`;
  }
  return { inner: s, vb: o.vb, P, Pinv: rot ? (X, Y) => [Y, -X] : (X, Y) => [X, Y] };
}
function planSVG(o, id) {
  const v = planView(o);
  return `<svg id="${id}" viewBox="${v.vb.map((x) => x.toFixed(1)).join(' ')}" role="img" aria-label="${esc(t('seatingTitle'))}">${v.inner}</svg>`;
}
function svgPoint(svg, e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const r = pt.matrixTransform(svg.getScreenCTM().inverse()); return [r.x, r.y];
}

// ---------- designer interactions ----------
function bindDesigner() {
  const svg = document.getElementById('designer'); if (!svg) return;
  const d = S.draft; let drag = null, raf = 0;
  const rot = shouldRotate(d.layout);
  const Pinv = rot ? (X, Y) => [Y, -X] : (X, Y) => [X, Y];
  const world = (e) => { const [X, Y] = svgPoint(svg, e); return Pinv(X, Y); };
  const redraw = () => { raf = 0; const v = planView({ layout: d.layout, mode: 'design', sel: S.ui.sel, showAdj: S.ui.showAdj, rot, vb: drag && drag.vb }); svg.innerHTML = v.inner; };
  svg.addEventListener('pointerdown', (e) => {
    const ch = e.target.closest('[data-chair]'), tb = e.target.closest('[data-table]');
    const w = world(e); const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    if (ch) { const c = d.layout.chairs.find((x) => x.id === ch.dataset.chair); drag = { kind: 'chair', c, start: w, o: [c.x, c.y], vb }; }
    else if (tb) { const tt = d.layout.tables.find((x) => x.id === tb.dataset.table); const cs = d.layout.chairs.filter((c) => c.tableId === tt.id); drag = { kind: 'table', t: tt, cs, co: cs.map((c) => [c.x, c.y]), start: w, o: [tt.x, tt.y], vb }; }
    else { if (S.ui.sel) { S.ui.sel = null; render(); } return; }
    drag.moved = false; svg.setPointerCapture(e.pointerId); e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return; const w = world(e); const dx = w[0] - drag.start[0], dy = w[1] - drag.start[1];
    if (!drag.moved && Math.hypot(dx, dy) < 5) return; drag.moved = true;
    if (drag.kind === 'chair') { drag.c.x = Math.round((drag.o[0] + dx) / 4) * 4; drag.c.y = Math.round((drag.o[1] + dy) / 4) * 4; }
    else { const sx = Math.round((drag.o[0] + dx) / 4) * 4 - drag.o[0], sy = Math.round((drag.o[1] + dy) / 4) * 4 - drag.o[1]; drag.t.x = drag.o[0] + sx; drag.t.y = drag.o[1] + sy; drag.cs.forEach((c, i) => { c.x = drag.co[i][0] + sx; c.y = drag.co[i][1] + sy; }); }
    if (!raf) raf = requestAnimationFrame(redraw);
  });
  const end = () => {
    if (!drag) return; const g = drag; drag = null;
    if (!g.moved) { S.ui.sel = g.kind === 'chair' ? { type: 'chair', id: g.c.id } : { type: 'table', id: g.t.id }; render(); return; }
    if (g.kind === 'table') snapTable(d.layout, g.t);
    else reassignChair(d.layout, g.c);
    d.layoutMode = 'custom'; render();
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
}
function aabb(t) { const vert = (t.rot || 0) % 180 !== 0 && t.shape === 'rect'; const w = vert ? t.h : t.w, h = vert ? t.w : t.h; return { x0: t.x - w / 2, x1: t.x + w / 2, y0: t.y - h / 2, y1: t.y + h / 2, w, h }; }
function snapTable(L, a) {
  if (a.shape !== 'rect') return;
  const A = aabb(a); let best = null;
  for (const b of L.tables) {
    if (b === a || b.shape !== 'rect') continue; const B = aabb(b);
    const cand = [];
    if (Math.abs(A.y0 - B.y0) < 40 || Math.abs(A.y1 - B.y1) < 40 || Math.abs(a.y - b.y) < 40) {
      cand.push({ dx: B.x1 - A.x0, dy: (A.h === B.h ? b.y - a.y : 0) }, { dx: B.x0 - A.x1, dy: (A.h === B.h ? b.y - a.y : 0) });
    }
    if (Math.abs(A.x0 - B.x0) < 40 || Math.abs(A.x1 - B.x1) < 40 || Math.abs(a.x - b.x) < 40) {
      cand.push({ dy: B.y1 - A.y0, dx: (A.w === B.w ? b.x - a.x : 0) }, { dy: B.y0 - A.y1, dx: (A.w === B.w ? b.x - a.x : 0) });
    }
    for (const c of cand) { const m = Math.hypot(c.dx, c.dy); if (m < 30 && (!best || m < best.m)) best = { ...c, m }; }
  }
  if (best && best.m > 0) { a.x += best.dx; a.y += best.dy; L.chairs.filter((c) => c.tableId === a.id).forEach((c) => { c.x += best.dx; c.y += best.dy; }); }
}
function distToTable(c, t) {
  const [lx, ly] = E.toLocal(t, c.x, c.y);
  if (t.shape === 'rect') { const dx = Math.max(0, Math.abs(lx) - t.w / 2), dy = Math.max(0, Math.abs(ly) - t.h / 2); return Math.hypot(dx, dy); }
  const r = Math.hypot(lx / (t.w / 2), ly / (t.h / 2)); return Math.max(0, (r - 1) * Math.min(t.w, t.h) / 2);
}
function reassignChair(L, c) { let best = null; for (const t of L.tables) { const dd = distToTable(c, t); if (!best || dd < best.d) best = { t, d: dd }; } if (best) c.tableId = best.t.id; }
function tableInfo(L, t) {
  const cs = L.chairs.filter((c) => c.tableId === t.id);
  if (t.shape !== 'rect') return { seats: cs.length };
  const ends = []; for (const c of cs) { const [lx] = E.toLocal(t, c.x, c.y); if (lx < -t.w / 2 - 4) ends.push(-1); else if (lx > t.w / 2 + 4) ends.push(1); }
  return { perSide: Math.max(1, Math.round(t.w / E.U)), ends: [...new Set(ends)] };
}
function rebuildTable(L, t, change) {
  const keepOff = L.chairs.filter((c) => c.tableId === t.id && c.disabled).length;
  L.chairs = L.chairs.filter((c) => c.tableId !== t.id);
  let cs;
  if (t.shape === 'rect') {
    const info = change.info; t.w = info.perSide * E.U;
    cs = E.rectChairs(t, info.perSide, info.ends);
  } else {
    const r = E.roundTable(t.x, t.y, change.seats, t.shape === 'oval'); t.w = r.tables[0].w; t.h = r.tables[0].h;
    cs = r.chairs; cs.forEach((c) => { c.tableId = t.id; });
    if (t.rot) cs.forEach((c) => { const p = rotAround(c.x, c.y, t.x, t.y, t.rot); c.x = p[0]; c.y = p[1]; });
  }
  cs.slice(0, keepOff).forEach((c) => { c.disabled = true; });
  L.chairs.push(...cs);
}
function rotAround(x, y, cx, cy, deg) { const r = deg * Math.PI / 180; const dx = x - cx, dy = y - cy; return [cx + dx * Math.cos(r) - dy * Math.sin(r), cy + dx * Math.sin(r) + dy * Math.cos(r)]; }

// ---------- seating editor interactions ----------
function bindSeating(ev, svgId, editable) {
  const svg = document.getElementById(svgId); if (!svg) return;
  const rot = shouldRotate(ev.layout); const Pinv = rot ? (X, Y) => [Y, -X] : (X, Y) => [X, Y];
  const P = rot ? (x, y) => [-y, x] : (x, y) => [x, y];
  let drag = null, raf = 0;
  const redraw = () => { raf = 0; const v = planView(seatOpts(ev, { rot, vb: drag && drag.vb, ghost: drag && drag.moved ? drag.ghost : null })); svg.innerHTML = v.inner; };
  svg.addEventListener('pointerdown', (e) => {
    const ch = e.target.closest('[data-chair]');
    if (!ch) { if (S.ui.chairSel) { S.ui.chairSel = null; render(); } return; }
    const cid = ch.dataset.chair; const pid = Object.keys(ev.plan.assignment).find((k) => ev.plan.assignment[k] === cid);
    drag = { from: cid, pid, moved: false, start: svgPoint(svg, e), vb: svg.getAttribute('viewBox').split(' ').map(Number) };
    if (editable && pid) svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || !editable || !drag.pid) return; const [X, Y] = svgPoint(svg, e);
    if (!drag.moved && Math.hypot(X - drag.start[0], Y - drag.start[1]) < 6) return;
    drag.moved = true; drag.ghost = { x: X, y: Y, pid: drag.pid, from: drag.from };
    if (!raf) raf = requestAnimationFrame(redraw);
  });
  const end = (e) => {
    if (!drag) return; const g = drag; drag = null;
    if (!g.moved) { S.ui.chairSel = g.from; render(); return; }
    const [X, Y] = svgPoint(svg, e); const [wx, wy] = Pinv(X, Y);
    let target = null, bd = 40;
    for (const c of ev.layout.chairs) { if (c.disabled) continue; const dd = Math.hypot(c.x - wx, c.y - wy); if (dd < bd) { bd = dd; target = c.id; } }
    if (target && target !== g.from) moveSeat(ev, g.from, target); else render();
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', () => { drag = null; render(); });
}
function seatOpts(ev, extra) {
  const pl = ev.plan; const sel = S.ui.chairSel;
  let highlight = [];
  if (sel) { const { adj } = E.computeAdjacency(ev.layout); highlight = adj.has(sel) ? [...adj.get(sel)] : []; }
  return Object.assign({ layout: ev.layout, mode: 'seat', assign: pl.assignment, people: ev.participants, locked: pl.locked, sel: sel ? { type: 'chair', id: sel } : null, highlight }, extra);
}
function moveSeat(ev, from, to) {
  const pl = ev.plan;
  if ((pl.locked || []).includes(from) || (pl.locked || []).includes(to)) { toast(t('locked')); render(); return; }
  const a = Object.keys(pl.assignment).find((k) => pl.assignment[k] === from), b = Object.keys(pl.assignment).find((k) => pl.assignment[k] === to);
  if (!a) { render(); return; }
  pl.assignment[a] = to; if (b) pl.assignment[b] = from;
  pl.current = E.evaluate(engineInput(ev), pl.assignment); pl.manual = true; pl.dirty = true; S.ui.chairSel = to;
  persist(); render();
}
