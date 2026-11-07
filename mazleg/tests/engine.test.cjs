const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./_load.cjs')('engine');

const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i }));
const adjOf = (layout) => E.computeAdjacency(layout).adj;
const isAdj = (layout, a, b, as) => adjOf(layout).get(as[a]).has(as[b]);

function family17() {
  // 3 connected tables, 3 seats per side, head seats → 2*9 + 2 = 20 seats
  const layout = E.connectedRect({ tables: 3, seatsPerSide: 3, headSeats: true });
  const ppl = people(17);
  const prefs = {};
  for (let i = 0; i < 17; i++) prefs['p' + i] = ['p' + ((i + 1) % 17), 'p' + ((i + 5) % 17)];
  prefs.p0 = ['p1', 'p2']; prefs.p1 = ['p0', 'p3']; // mutual p0<->p1
  prefs.p4 = ['p6', 'p7']; prefs.p6 = ['p4', 'p9']; // mutual p4<->p6
  return { people: ppl, prefs, layout };
}

test('adjacency comes from geometry, not seat numbers', () => {
  const L = E.connectedRect({ tables: 2, seatsPerSide: 2, headSeats: false });
  // chairs: table0 [top0, top1, bot0, bot1], table1 [top0, top1, bot0, bot1]
  const c = L.chairs.map(x => x.id);
  const A = adjOf(L);
  assert.ok(A.get(c[1]).has(c[4]), 'last top seat of table 1 touches first top seat of table 2 across the joint');
  assert.ok(!A.get(c[1]).has(c[2]), 'consecutive ids on opposite sides are not adjacent');
  assert.ok(!A.get(c[0]).has(c[2]), 'chairs facing each other across the table are not "next to"');
  assert.ok(E.computeAdjacency(L).across.get(c[0]).has(c[2]), 'but they are recorded as across');
});

test('head seat is adjacent to the two corner seats', () => {
  const L = E.connectedRect({ tables: 1, seatsPerSide: 3, headSeats: true });
  const head = L.chairs[6].id, topCorner = L.chairs[0].id, botCorner = L.chairs[3].id;
  const A = adjOf(L);
  assert.ok(A.get(head).has(topCorner) && A.get(head).has(botCorner));
  assert.ok(!A.get(head).has(L.chairs[1].id));
});

test('dragging a chair changes adjacency', () => {
  const L = E.connectedRect({ tables: 1, seatsPerSide: 3, headSeats: false });
  const [a, b] = L.chairs;
  assert.ok(adjOf(L).get(a.id).has(b.id));
  b.x += 400;
  assert.ok(!adjOf(L).get(a.id).has(b.id));
});

test('17 participants: everyone seated once, valid, deterministic', () => {
  const input = family17();
  const r1 = E.optimize({ ...input, seed: 3 });
  const r2 = E.optimize({ ...input, seed: 3 });
  assert.ok(r1.ok);
  assert.equal(r1.method, 'annealing');
  assert.deepEqual(E.validateAssignment(input, r1.best.assignment), []);
  assert.equal(new Set(Object.values(r1.best.assignment)).size, 17, 'no duplicate seats');
  assert.deepEqual(r1.best.assignment, r2.best.assignment, 'same seed → same result');
  // 20-seat ring → each person has 2 neighbours; with mostly one-sided wishes ~17-19 is the ceiling
  assert.ok(r1.best.stats.fulfilled >= 17, 'got ' + r1.best.stats.fulfilled);
  const rnd = E.evaluate(input, Object.fromEntries(input.people.map((p, i) => [p.id, input.layout.chairs[i].id])));
  assert.ok(r1.best.score > rnd.score, 'beats naive seating');
  const strong = E.optimize({ ...input, effort: 3 });
  assert.ok(strong.best.score - r1.best.score <= 10, 'default effort is near the high-effort optimum');
  assert.equal(r1.best.stats.mutualMet, r1.best.stats.mutualPairs);
  for (const alt of r1.alternatives) assert.deepEqual(E.validateAssignment(input, alt.assignment), []);
});

test('mutual preferences are always honoured when feasible', () => {
  const L = E.connectedRect({ tables: 1, seatsPerSide: 3, headSeats: false });
  const input = { people: people(6), layout: L, prefs: { p0: ['p5'], p5: ['p0'], p2: ['p3'], p3: ['p2'] } };
  const r = E.optimize(input);
  assert.equal(r.method, 'exhaustive');
  assert.ok(isAdj(L, 'p0', 'p5', r.best.assignment));
  assert.ok(isAdj(L, 'p2', 'p3', r.best.assignment));
  assert.equal(r.best.stats.mutualMet, 2);
});

test('conflicting preferences: best compromise, reported honestly', () => {
  // Everyone wants p0, but p0 can only have 2 neighbours on a straight bench
  const L = E.connectedRect({ tables: 1, seatsPerSide: 3, headSeats: false });
  const prefs = { p1: ['p0'], p2: ['p0'], p3: ['p0'], p4: ['p0'], p0: ['p1'] };
  const r = E.optimize({ people: people(6), layout: L, prefs });
  assert.ok(r.ok);
  assert.equal(r.best.stats.fulfilled, 3, 'p0 + two of the fans');
  assert.equal(r.best.stats.votersWithNone, 2);
  assert.ok(isAdj(L, 'p0', 'p1', r.best.assignment), 'mutual-ish pair p0<->p1 kept');
});

test('insufficient seating is rejected with a clear error', () => {
  const L = E.connectedRect({ tables: 1, seatsPerSide: 2, headSeats: false });
  const r = E.optimize({ people: people(5), layout: L, prefs: {} });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'insufficient_seats');
  assert.equal(r.errors[0].seats, 4);
});

test('unavailable seats are never used', () => {
  const L = E.connectedRect({ tables: 2, seatsPerSide: 4, headSeats: true });
  const off = new Set([L.chairs[0].id, L.chairs[5].id, L.chairs[9].id]);
  L.chairs.forEach(c => { if (off.has(c.id)) c.disabled = true; });
  const input = { people: people(15), layout: L, prefs: { p0: ['p1', 'p2'], p1: ['p0'] } };
  const r = E.optimize(input);
  assert.ok(r.ok);
  for (const c of Object.values(r.best.assignment)) assert.ok(!off.has(c));
  assert.deepEqual(E.validateAssignment(input, r.best.assignment), []);
  L.chairs[1].disabled = true; L.chairs[2].disabled = true;
  assert.equal(E.optimize(input).ok, false, '15 people, 13 seats → infeasible');
});

test('multiple connected tables + separate round tables', () => {
  const L = E.connectedRect({ tables: 4, seatsPerSide: 2, headSeats: true, orientation: 'vertical' });
  const input = { people: people(18), layout: L, prefs: { p0: ['p17'], p17: ['p0'], p3: ['p9', 'p10'] } };
  const r = E.optimize(input);
  assert.ok(r.ok && isAdj(L, 'p0', 'p17', r.best.assignment));
  assert.deepEqual(E.validateAssignment(input, r.best.assignment), []);

  const R = E.separateTables(2, 6, false);
  const A = adjOf(R);
  const t0 = R.chairs.filter(c => c.tableId === R.tables[0].id).map(c => c.id);
  const t1 = R.chairs.filter(c => c.tableId === R.tables[1].id).map(c => c.id);
  for (const a of t0) { assert.equal(A.get(a).size, 2); for (const b of t1) assert.ok(!A.get(a).has(b)); }
});

test('locks and keep-apart constraints are respected', () => {
  const input = family17();
  const target = input.layout.chairs[6].id; // head seat
  input.constraints = { locks: { p10: target }, apart: [['p0', 'p1']] };
  const r = E.optimize(input);
  assert.equal(r.best.assignment.p10, target);
  assert.ok(!isAdj(input.layout, 'p0', 'p1', r.best.assignment), 'organizer rule beats mutual wish');
  assert.deepEqual(r.best.violations, []);
  assert.deepEqual(E.validateAssignment(input, r.best.assignment), []);
});

test('preferences are sanitised: self-votes, unknown ids and >2 choices ignored', () => {
  const L = E.connectedRect({ tables: 1, seatsPerSide: 2, headSeats: false });
  const r = E.optimize({ people: people(4), layout: L, prefs: { p0: ['p0', 'ghost', 'p1', 'p2', 'p3'] } });
  assert.equal(r.best.stats.total, 2);
  assert.equal(r.best.perPerson.p0.requested, 2);
});

test('100 participants complete quickly and validly', () => {
  const L = E.connectedRect({ tables: 10, seatsPerSide: 5, headSeats: true });
  const ppl = people(100), prefs = {};
  const rand = E.rng(5);
  for (const p of ppl) prefs[p.id] = ['p' + Math.floor(rand() * 100), 'p' + Math.floor(rand() * 100)];
  const t = Date.now();
  const r = E.optimize({ people: ppl, layout: L, prefs, effort: 0.5 });
  const ms = Date.now() - t;
  assert.ok(r.ok);
  assert.deepEqual(E.validateAssignment({ people: ppl, layout: L }, r.best.assignment), []);
  assert.ok(ms < 8000, 'took ' + ms + 'ms');
});

test('evaluate scores a hand-edited plan consistently', () => {
  const input = family17();
  const r = E.optimize(input);
  const ev = E.evaluate(input, r.best.assignment);
  assert.equal(ev.score, r.best.score);
});
