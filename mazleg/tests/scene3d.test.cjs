const test = require('node:test'); const assert = require('node:assert/strict');
const E = require('./_load.cjs')('engine'); const S3 = require('./_load.cjs')('scene3d');
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i }));

test('3D spec mirrors the layout exactly: same ids, every chair, every table', () => {
  const L = E.connectedRect({ tables: 3, seatsPerSide: 3, headSeats: true });
  L.chairs[4].disabled = true;
  const sp = S3.spec(L);
  assert.equal(sp.tables.length, 3);
  assert.deepEqual(sp.chairs.map((c) => c.id), L.chairs.map((c) => c.id));
  assert.equal(sp.chairs.filter((c) => c.setting).length, 19, 'place settings only at available chairs');
  assert.ok(sp.chairs[4].disabled && !sp.chairs[4].setting);
  sp.tables.forEach((t) => assert.equal(t.legs.length, 4));
  // 1 layout unit = 1cm
  assert.ok(Math.abs(sp.tables[0].w - 1.92) < 1e-9 && Math.abs(sp.tables[0].d - 0.96) < 1e-9);
});

test('every chair faces its table and its plate sits on the tabletop', () => {
  for (const L of [E.connectedRect({ tables: 2, seatsPerSide: 4, headSeats: true, orientation: 'vertical' }), E.roundTable(0, 0, 9, false), E.roundTable(0, 0, 10, true)]) {
    const sp = S3.spec(L); const t = L.tables[0];
    for (const c of sp.chairs) {
      const tb = L.tables.find((x) => x.id === c.tableId);
      const [lx, ly] = E.toLocal(tb, c.setting.plate[0] / 0.01, c.setting.plate[1] / 0.01);
      const inside = tb.shape === 'rect' ? Math.abs(lx) < tb.w / 2 && Math.abs(ly) < tb.h / 2 : (lx * lx) / (tb.w * tb.w / 4) + (ly * ly) / (tb.h * tb.h / 4) < 1;
      assert.ok(inside, 'plate on table for ' + c.id);
    }
  }
});

test('left and right are from the seated person\u2019s point of view', () => {
  const L = E.connectedRect({ tables: 1, seatsPerSide: 3, headSeats: false }); // top row: c0 c1 c2 (x increasing), bottom: c3 c4 c5
  const ids = L.chairs.map((c) => c.id);
  const assign = { a: ids[0], b: ids[1], c: ids[2], d: ids[3], e: ids[4], f: ids[5] };
  // top row faces down (south): their right hand points west (-x)
  let s = S3.sides(L, assign, 'b'); assert.equal(s.right, 'a'); assert.equal(s.left, 'c'); assert.deepEqual(s.across, ['e']);
  // bottom row faces north: right hand points east (+x)
  s = S3.sides(L, assign, 'e'); assert.equal(s.right, 'f'); assert.equal(s.left, 'd');
  s = S3.sides(L, assign, 'a'); assert.equal(s.left, 'b'); assert.equal(s.right, null);
});

test('3D neighbours equal engine adjacency for the 17-person family', () => {
  const L = E.connectedRect({ tables: 3, seatsPerSide: 3, headSeats: true });
  const prefs = {}; for (let i = 0; i < 17; i++) prefs['p' + i] = ['p' + ((i + 1) % 17)];
  const r = E.optimize({ people: people(17), layout: L, prefs });
  for (let i = 0; i < 17; i++) {
    const s = S3.sides(L, r.best.assignment, 'p' + i); const n = E.neighbors(L, r.best.assignment, 'p' + i);
    assert.deepEqual([s.left, s.right, ...s.also].filter(Boolean).sort(), n.beside.slice().sort());
  }
  assert.equal(new Set(Object.values(r.best.assignment)).size, 17, 'each person exactly once');
});

test('labels never overlap, even when crowded', () => {
  const items = []; for (let i = 0; i < 40; i++) items.push({ id: 'l' + i, x: 200 + (i % 8) * 30, y: 150 + Math.floor(i / 8) * 12, w: 80, h: 22, cw: 28, ch: 22 });
  const res = S3.placeLabels(items, { x0: 0, y0: 0, x1: 900, y1: 700 });
  const rects = res.filter((r) => !r.hidden).map((r) => { const it = items.find((x) => x.id === r.id); const w = r.compact ? it.cw : it.w, h = r.compact ? it.ch : it.h; return [r.x - w / 2, r.x + w / 2, r.y - h / 2, r.y + h / 2]; });
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; assert.ok(a[1] <= b[0] || b[1] <= a[0] || a[3] <= b[2] || b[3] <= a[2], 'overlap ' + i + ' ' + j); }
  // 17 labels around a real table fit without hiding anyone
  const L = E.connectedRect({ tables: 3, seatsPerSide: 3, headSeats: true }); const sp = S3.spec(L);
  const it17 = sp.chairs.slice(0, 17).map((c, i) => ({ id: c.id, x: 450 + (c.x - sp.bounds.cx) * 120, y: 300 + (c.z - sp.bounds.cz) * 120, w: 90, h: 24, cw: 30, ch: 24 }));
  assert.equal(S3.placeLabels(it17, { x0: 0, y0: 0, x1: 900, y1: 600 }).filter((r) => r.hidden).length, 0);
});
