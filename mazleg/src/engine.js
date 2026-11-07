/* MAZLEG seating engine — pure, deterministic, UI-independent.
 * Geometry model: tables + chairs with real coordinates and facing.
 * Adjacency is derived from chair positions, never from seat numbers. */
(function (root) {
  'use strict';
  const U = 64;          // nominal chair pitch (layout units)
  const DEPTH = 96;      // rectangular table depth
  const OFF = 34;        // chair centre distance from table edge

  // ---------- RNG ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- geometry ----------
  function toLocal(t, x, y) {
    const r = -(t.rot || 0) * Math.PI / 180;
    const dx = x - t.x, dy = y - t.y;
    return [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
  }
  function toWorld(t, lx, ly) {
    const r = (t.rot || 0) * Math.PI / 180;
    return [t.x + lx * Math.cos(r) - ly * Math.sin(r), t.y + lx * Math.sin(r) + ly * Math.cos(r)];
  }
  /** Angle (radians, world) a chair faces: towards the nearest point of its table. */
  function facing(chair, table) {
    if (!table) return 0;
    const [lx, ly] = toLocal(table, chair.x, chair.y);
    let tx, ty;
    if (table.shape === 'rect') {
      const hw = table.w / 2, hh = table.h / 2;
      tx = Math.max(-hw, Math.min(hw, lx)); ty = Math.max(-hh, Math.min(hh, ly));
      if (tx === lx && ty === ly) { // inside: push to the dominant edge
        if (Math.abs(lx) / hw > Math.abs(ly) / hh) tx = Math.sign(lx) * hw; else ty = Math.sign(ly) * hh;
        tx = lx - (tx - lx); ty = ly - (ty - ly);
      }
    } else { tx = 0; ty = 0; }
    const [wx, wy] = toWorld(table, tx, ty);
    return Math.atan2(wy - chair.y, wx - chair.x);
  }
  function angDiff(a, b) {
    let d = Math.abs(a - b) % (2 * Math.PI);
    return d > Math.PI ? 2 * Math.PI - d : d;
  }

  // ---------- layout builders ----------
  let uid = 0;
  const nid = (p) => p + (++uid).toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  function rectChairs(t, perSide, ends) {
    const out = [];
    const startX = -t.w / 2 + U / 2;
    for (let side of [-1, 1]) for (let i = 0; i < perSide; i++) {
      const [x, y] = toWorld(t, startX + i * U, side * (t.h / 2 + OFF));
      out.push({ id: nid('c'), tableId: t.id, x, y });
    }
    for (const e of ends || []) {
      const [x, y] = toWorld(t, e * (t.w / 2 + OFF), 0);
      out.push({ id: nid('c'), tableId: t.id, x, y });
    }
    return out;
  }
  function rectTable(x, y, perSide, rot) {
    return { id: nid('t'), shape: 'rect', x, y, w: perSide * U, h: DEPTH, rot: rot || 0 };
  }
  /** N rectangular tables joined end-to-end; head seats optional on the two outer ends. */
  function connectedRect(opts) {
    const n = Math.max(1, opts.tables | 0), k = Math.max(1, opts.seatsPerSide | 0);
    const vertical = opts.orientation === 'vertical';
    const tables = [], chairs = [];
    const len = k * U, total = n * len;
    for (let i = 0; i < n; i++) {
      const off = -total / 2 + len / 2 + i * len;
      const t = rectTable(vertical ? 0 : off, vertical ? off : 0, k, vertical ? 90 : 0);
      tables.push(t);
      const ends = [];
      if (opts.headSeats) { if (i === 0) ends.push(-1); if (i === n - 1) ends.push(1); }
      chairs.push(...rectChairs(t, k, ends));
    }
    return { tables, chairs };
  }
  function roundTable(x, y, seats, oval) {
    const s = Math.max(2, seats | 0);
    const circumference = s * U * 1.05;
    let rx = Math.max(56, circumference / (2 * Math.PI) - OFF), ry = rx;
    if (oval) { rx *= 1.35; ry *= 0.72; }
    const t = { id: nid('t'), shape: oval ? 'oval' : 'round', x, y, w: rx * 2, h: ry * 2, rot: 0 };
    const chairs = [];
    for (let i = 0; i < s; i++) {
      const a = (i / s) * 2 * Math.PI - Math.PI / 2;
      chairs.push({ id: nid('c'), tableId: t.id, x: x + (rx + OFF) * Math.cos(a), y: y + (ry + OFF) * Math.sin(a) });
    }
    return { tables: [t], chairs };
  }
  /** Several separate round/oval tables in a grid. */
  function separateTables(count, seats, oval) {
    const tables = [], chairs = [];
    const cols = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      const r = roundTable((i % cols) * 360, Math.floor(i / cols) * 320, seats, oval);
      tables.push(...r.tables); chairs.push(...r.chairs);
    }
    return { tables, chairs };
  }

  // ---------- adjacency ----------
  /** Returns {adj: Map<chairId, Set<chairId>>, across: Map, spacing}. */
  function computeAdjacency(layout) {
    const tById = new Map(layout.tables.map(t => [t.id, t]));
    const cs = layout.chairs.filter(c => !c.disabled);
    const f = new Map(cs.map(c => [c.id, facing(c, tById.get(c.tableId))]));
    const adj = new Map(cs.map(c => [c.id, new Set()]));
    const across = new Map(cs.map(c => [c.id, new Set()]));
    if (cs.length < 2) return { adj, across, spacing: U };
    const nn = cs.map(a => {
      let m = Infinity;
      for (const b of cs) if (a !== b) m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y));
      return m;
    }).sort((a, b) => a - b);
    const spacing = Math.max(20, nn[Math.floor(nn.length / 2)]);
    const lim = spacing * 1.75;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const fd = angDiff(f.get(a.id), f.get(b.id));
      if (d <= lim && fd <= (100 * Math.PI / 180)) { adj.get(a.id).add(b.id); adj.get(b.id).add(a.id); }
      else if (fd > 150 * Math.PI / 180 && d <= spacing * 2.7) {
        // opposite chairs whose line crosses their table
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const t = tById.get(a.tableId) || tById.get(b.tableId);
        if (t) {
          const [lx, ly] = toLocal(t, mx, my);
          if (Math.abs(lx) <= t.w / 2 + 4 && Math.abs(ly) <= t.h / 2 + 4) { across.get(a.id).add(b.id); across.get(b.id).add(a.id); }
        }
      }
    }
    const o = layout.adjacencyOverrides || {};
    for (const [x, y] of o.add || []) if (adj.has(x) && adj.has(y)) { adj.get(x).add(y); adj.get(y).add(x); }
    for (const [x, y] of o.remove || []) if (adj.has(x) && adj.has(y)) { adj.get(x).delete(y); adj.get(y).delete(x); }
    return { adj, across, spacing };
  }

  // ---------- model ----------
  const W = { pref: 10, mutual: 10, together: 40, apart: -100, unmet: -3 };

  function prepare(input) {
    const errors = [];
    const people = input.people.map(p => p.id);
    const pIdx = new Map(people.map((id, i) => [id, i]));
    const { adj, across } = computeAdjacency(input.layout);
    const chairs = input.layout.chairs.filter(c => !c.disabled).map(c => c.id);
    const cIdx = new Map(chairs.map((id, i) => [id, i]));
    if (chairs.length < people.length) errors.push({ code: 'insufficient_seats', seats: chairs.length, people: people.length });
    const n = people.length, m = chairs.length;
    const A = new Uint8Array(m * m);
    chairs.forEach((c, i) => adj.get(c).forEach(d => { A[i * m + cIdx.get(d)] = 1; }));

    // preference edges
    const prefs = input.prefs || {};
    const want = people.map(() => []);
    for (const [pid, list] of Object.entries(prefs)) {
      const i = pIdx.get(pid); if (i === undefined) continue;
      const seen = new Set();
      for (const t of (list || [])) {
        const j = pIdx.get(t);
        if (j === undefined || j === i || seen.has(j)) continue;
        seen.add(j); want[i].push(j);
        if (want[i].length === 2) break;
      }
    }
    const terms = []; // {a,b,w,kind}
    for (let i = 0; i < n; i++) for (const j of want[i]) terms.push({ a: i, b: j, w: W.pref, kind: 'pref' });
    const mutualPairs = [];
    for (let i = 0; i < n; i++) for (const j of want[i]) if (j > i && want[j].includes(i)) { mutualPairs.push([i, j]); terms.push({ a: i, b: j, w: W.mutual, kind: 'mutual' }); }
    const cons = input.constraints || {};
    for (const [x, y] of cons.together || []) { const a = pIdx.get(x), b = pIdx.get(y); if (a !== undefined && b !== undefined && a !== b) terms.push({ a, b, w: W.together, kind: 'together' }); }
    for (const [x, y] of cons.apart || []) { const a = pIdx.get(x), b = pIdx.get(y); if (a !== undefined && b !== undefined && a !== b) terms.push({ a, b, w: W.apart, kind: 'apart' }); }

    // locks
    const lockChair = new Int32Array(n).fill(-1);
    const usedLock = new Set();
    for (const [pid, cid] of Object.entries(cons.locks || {})) {
      const i = pIdx.get(pid), c = cIdx.get(cid);
      if (i === undefined) continue;
      if (c === undefined) { errors.push({ code: 'lock_unavailable_seat', person: pid, chair: cid }); continue; }
      if (usedLock.has(c)) { errors.push({ code: 'lock_conflict', person: pid, chair: cid }); continue; }
      usedLock.add(c); lockChair[i] = c;
    }
    // incidence lists
    const termsOf = people.map(() => []);
    terms.forEach((t, k) => { termsOf[t.a].push(k); termsOf[t.b].push(k); });
    const voters = []; for (let i = 0; i < n; i++) if (want[i].length) voters.push(i);
    const fairOf = people.map(() => new Set());
    for (const v of voters) { fairOf[v].add(v); for (const j of want[v]) fairOf[j].add(v); }
    return { errors, people, chairs, n, m, A, want, terms, termsOf, fairOf, mutualPairs, lockChair, adj, across, cIdx, pIdx };
  }

  function termVal(P, t, seat) { const on = P.A[seat[t.a] * P.m + seat[t.b]]; return on ? t.w : 0; }
  function unmet(P, v, seat) {
    for (const j of P.want[v]) if (P.A[seat[v] * P.m + seat[j]]) return 0;
    return W.unmet;
  }
  function fullScore(P, seat) {
    let s = 0;
    for (const t of P.terms) s += termVal(P, t, seat);
    for (let v = 0; v < P.n; v++) if (P.want[v].length) s += unmet(P, v, seat);
    return s;
  }
  function localScore(P, seat, who) {
    const ts = new Set(), fs = new Set();
    for (const p of who) { for (const k of P.termsOf[p]) ts.add(k); for (const v of P.fairOf[p]) fs.add(v); }
    let s = 0;
    ts.forEach(k => { s += termVal(P, P.terms[k], seat); });
    fs.forEach(v => { s += unmet(P, v, seat); });
    return s;
  }

  function initial(P, rand) {
    const seat = new Int32Array(P.n).fill(-1), occ = new Int32Array(P.m).fill(-1);
    for (let i = 0; i < P.n; i++) if (P.lockChair[i] >= 0) { seat[i] = P.lockChair[i]; occ[seat[i]] = i; }
    const free = []; for (let c = 0; c < P.m; c++) if (occ[c] < 0) free.push(c);
    for (let k = free.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [free[k], free[j]] = [free[j], free[k]]; }
    let q = 0;
    for (let i = 0; i < P.n; i++) if (seat[i] < 0) { seat[i] = free[q++]; occ[seat[i]] = i; }
    return { seat, occ };
  }

  function anneal(P, rand, iters, start) {
    const { seat, occ } = start || initial(P, rand);
    const movable = []; for (let i = 0; i < P.n; i++) if (P.lockChair[i] < 0) movable.push(i);
    const freeChairs = []; for (let c = 0; c < P.m; c++) if (!P.lockChair.includes(c)) freeChairs.push(c);
    let cur = fullScore(P, seat), best = cur, bestSeat = seat.slice();
    if (movable.length < 1) return { seat: bestSeat, score: best };
    let T = 12, Tend = 0.05; const decay = Math.pow(Tend / T, 1 / Math.max(1, iters));
    for (let it = 0; it < iters; it++, T *= decay) {
      const a = movable[Math.floor(rand() * movable.length)];
      const c2 = freeChairs[Math.floor(rand() * freeChairs.length)];
      if (c2 === seat[a]) continue;
      const b = occ[c2];
      if (b >= 0 && P.lockChair[b] >= 0) continue;
      const who = b >= 0 ? [a, b] : [a];
      const before = localScore(P, seat, who);
      const c1 = seat[a];
      seat[a] = c2; occ[c2] = a; if (b >= 0) { seat[b] = c1; occ[c1] = b; } else occ[c1] = -1;
      const delta = localScore(P, seat, who) - before;
      if (delta >= 0 || rand() < Math.exp(delta / T)) {
        cur += delta;
        if (cur > best) { best = cur; bestSeat = seat.slice(); }
      } else {
        seat[a] = c1; occ[c1] = a; if (b >= 0) { seat[b] = c2; occ[c2] = b; } else occ[c2] = -1;
      }
    }
    return { seat: bestSeat, score: best };
  }

  /** Exhaustive search for small instances — guaranteed optimum. */
  function exhaustive(P) {
    const seat = new Int32Array(P.n).fill(-1), used = new Uint8Array(P.m);
    for (let i = 0; i < P.n; i++) if (P.lockChair[i] >= 0) { seat[i] = P.lockChair[i]; used[seat[i]] = 1; }
    let best = -Infinity, bestSeat = null; const all = [];
    (function rec(i) {
      if (i === P.n) {
        const s = fullScore(P, seat);
        all.push({ seat: seat.slice(), score: s });
        if (s > best) { best = s; bestSeat = seat.slice(); }
        return;
      }
      if (P.lockChair[i] >= 0) return rec(i + 1);
      for (let c = 0; c < P.m; c++) if (!used[c]) { used[c] = 1; seat[i] = c; rec(i + 1); used[c] = 0; seat[i] = -1; }
    })(0);
    return { best: { seat: bestSeat, score: best }, all };
  }
  function permCount(n, m) { let r = 1; for (let i = 0; i < n; i++) r *= (m - i); return r; }

  function pairSignature(P, seat) {
    const pairs = [];
    for (let i = 0; i < P.n; i++) for (let j = i + 1; j < P.n; j++) if (P.A[seat[i] * P.m + seat[j]]) pairs.push(i + '-' + j);
    return pairs.join(',');
  }

  function describe(P, seat, input) {
    const assignment = {};
    P.people.forEach((pid, i) => { assignment[pid] = P.chairs[seat[i]]; });
    let fulfilled = 0, total = 0, mutualMet = 0;
    const perPerson = {};
    for (let i = 0; i < P.n; i++) {
      if (!P.want[i].length) continue;
      let met = 0;
      for (const j of P.want[i]) { total++; if (P.A[seat[i] * P.m + seat[j]]) { fulfilled++; met++; } }
      perPerson[P.people[i]] = { requested: P.want[i].length, fulfilled: met };
    }
    for (const [i, j] of P.mutualPairs) if (P.A[seat[i] * P.m + seat[j]]) mutualMet++;
    const violations = [];
    for (const t of P.terms) {
      const on = !!P.A[seat[t.a] * P.m + seat[t.b]];
      if (t.kind === 'together' && !on) violations.push({ kind: 'together', a: P.people[t.a], b: P.people[t.b] });
      if (t.kind === 'apart' && on) violations.push({ kind: 'apart', a: P.people[t.a], b: P.people[t.b] });
    }
    const unmetMutual = P.mutualPairs.filter(([i, j]) => !P.A[seat[i] * P.m + seat[j]]).map(([i, j]) => [P.people[i], P.people[j]]);
    const score = fullScore(P, seat);
    return {
      assignment, score,
      stats: {
        fulfilled, total, mutualPairs: P.mutualPairs.length, mutualMet,
        satisfaction: total ? Math.round((fulfilled / total) * 100) : 100,
        votersWithNone: Object.values(perPerson).filter(x => x.fulfilled === 0).length,
        voters: Object.keys(perPerson).length,
      },
      perPerson, violations, unmetMutual,
    };
  }

  /**
   * optimize(input) → { ok, errors, best, alternatives, method }
   * input = { people:[{id}], prefs:{pid:[pid,pid]}, layout:{tables,chairs}, constraints:{locks,together,apart}, seed, effort }
   */
  function optimize(input) {
    const P = prepare(input);
    if (P.errors.length) return { ok: false, errors: P.errors };
    if (P.n === 0) return { ok: true, errors: [], best: describe(P, new Int32Array(0), input), alternatives: [], method: 'trivial' };
    const seed = input.seed == null ? 17 : input.seed;
    let results = [], method;
    const free = P.lockChair.filter(x => x < 0).length;
    if (permCount(free, P.m - (P.n - free)) <= 60000) {
      method = 'exhaustive';
      const ex = exhaustive(P);
      results = ex.all.sort((a, b) => b.score - a.score);
    } else {
      method = 'annealing';
      const effort = input.effort || 1;
      const iters = Math.round(Math.min(250000, Math.max(20000, 4000 * P.n)) * effort);
      const restarts = Math.max(4, Math.round(6 * effort));
      for (let r = 0; r < restarts; r++) {
        const rand = rng(seed * 7919 + r * 104729);
        const res = anneal(P, rand, iters);
        // polish: deterministic first-improvement swaps
        results.push(polish(P, res.seat));
      }
      results.sort((a, b) => b.score - a.score);
    }
    const out = [], sigs = new Set();
    for (const r of results) {
      const sig = pairSignature(P, r.seat);
      if (sigs.has(sig)) continue;
      sigs.add(sig); out.push(describe(P, r.seat, input));
      if (out.length >= 4) break;
    }
    return { ok: true, errors: [], best: out[0], alternatives: out.slice(1), method };
  }

  function polish(P, seat0) {
    const seat = seat0.slice(), occ = new Int32Array(P.m).fill(-1);
    seat.forEach((c, i) => { occ[c] = i; });
    let improved = true, cur = fullScore(P, seat), guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let a = 0; a < P.n; a++) {
        if (P.lockChair[a] >= 0) continue;
        for (let c2 = 0; c2 < P.m; c2++) {
          if (c2 === seat[a] || P.lockChair.includes(c2)) continue;
          const b = occ[c2]; if (b >= 0 && P.lockChair[b] >= 0) continue;
          const who = b >= 0 ? [a, b] : [a];
          const before = localScore(P, seat, who), c1 = seat[a];
          seat[a] = c2; occ[c2] = a; if (b >= 0) { seat[b] = c1; occ[c1] = b; } else occ[c1] = -1;
          const d = localScore(P, seat, who) - before;
          if (d > 0) { cur += d; improved = true; }
          else { seat[a] = c1; occ[c1] = a; if (b >= 0) { seat[b] = c2; occ[c2] = b; } else occ[c2] = -1; }
        }
      }
    }
    return { seat, score: cur };
  }

  /** Score an arbitrary (e.g. hand-edited) assignment. */
  function evaluate(input, assignment) {
    const P = prepare(input);
    const seat = new Int32Array(P.n);
    P.people.forEach((pid, i) => { seat[i] = P.cIdx.has(assignment[pid]) ? P.cIdx.get(assignment[pid]) : -1; });
    if ([...seat].some(s => s < 0)) return null;
    return describe(P, seat, input);
  }

  /** Hard-constraint checker used by tests and before saving. */
  function validateAssignment(input, assignment) {
    const errs = [];
    const active = new Set(input.layout.chairs.filter(c => !c.disabled).map(c => c.id));
    const used = new Map();
    for (const p of input.people) {
      const c = assignment[p.id];
      if (!c) errs.push('unseated:' + p.id);
      else if (!active.has(c)) errs.push('inactive_seat:' + p.id);
      else if (used.has(c)) errs.push('double:' + c);
      else used.set(c, p.id);
    }
    for (const [pid, cid] of Object.entries((input.constraints || {}).locks || {})) if (assignment[pid] !== cid) errs.push('lock_broken:' + pid);
    return errs;
  }

  function neighbors(layout, assignment, personId) {
    const { adj, across } = computeAdjacency(layout);
    const byChair = {}; for (const [p, c] of Object.entries(assignment)) byChair[c] = p;
    const c = assignment[personId]; if (!c || !adj.has(c)) return { beside: [], across: [] };
    return {
      beside: [...adj.get(c)].map(x => byChair[x]).filter(Boolean),
      across: [...across.get(c)].map(x => byChair[x]).filter(Boolean),
    };
  }

  const api = { U, DEPTH, OFF, rng, facing, computeAdjacency, connectedRect, roundTable, separateTables, rectTable, rectChairs, optimize, evaluate, validateAssignment, neighbors, toWorld, toLocal, weights: W };
  root.MazlegEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
