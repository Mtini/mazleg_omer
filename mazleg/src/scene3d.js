/* MAZLEG 3D — the virtual table is generated from the SAME layout (table + chair ids, positions)
 * and the SAME adjacency model the seating engine uses. 1 layout unit = 1 cm. */
(function (root) {
  'use strict';
  const Eng = root.MazlegEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const S = 0.01, TOP_Y = 0.75, TOP_T = 0.04;

  // ---------- pure: scene specification ----------
  function spec(layout) {
    const tById = new Map(layout.tables.map((t) => [t.id, t]));
    const tables = layout.tables.map((t) => {
      const base = { id: t.id, shape: t.shape, x: t.x * S, z: t.y * S, w: t.w * S, d: t.h * S, rotY: -(t.rot || 0) * Math.PI / 180 };
      if (t.shape === 'rect') {
        const ix = t.w / 2 - 7, iz = t.h / 2 - 7;
        base.legs = [[-ix, -iz], [ix, -iz], [ix, iz], [-ix, iz]].map(([lx, ly]) => { const [wx, wy] = Eng.toWorld(t, lx, ly); return [wx * S, wy * S]; });
      }
      return base;
    });
    const chairs = layout.chairs.map((c) => {
      const a = Eng.facing(c, tById.get(c.tableId));
      const dir = [Math.cos(a), Math.sin(a)], right = [Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2)];
      const x = c.x * S, z = c.y * S;
      const out = { id: c.id, tableId: c.tableId, x, z, rotY: -a, disabled: !!c.disabled, dir, right,
        label: [x - dir[0] * 0.12, 1.12, z - dir[1] * 0.12] };
      if (!c.disabled) {
        const px = x + dir[0] * 0.58, pz = z + dir[1] * 0.58;
        out.setting = { plate: [px, pz], fork: [px - right[0] * 0.17, pz - right[1] * 0.17], knife: [px + right[0] * 0.17, pz + right[1] * 0.17],
          glass: [px + dir[0] * 0.17 + right[0] * 0.15, pz + dir[1] * 0.17 + right[1] * 0.15] };
      }
      return out;
    });
    // bounds
    const xs = [], zs = [];
    chairs.forEach((c) => { xs.push(c.x); zs.push(c.z); });
    tables.forEach((t) => { const r = Math.max(t.w, t.d) / 2; xs.push(t.x - r, t.x + r); zs.push(t.z - r, t.z + r); });
    if (!xs.length) { xs.push(0); zs.push(0); }
    const bounds = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    bounds.cx = (bounds.x0 + bounds.x1) / 2; bounds.cz = (bounds.z0 + bounds.z1) / 2;
    return { tables, chairs, bounds, topY: TOP_Y };
  }

  /** Who sits on a person's left and right, from their own point of view (facing the table). */
  function sides(layout, assignment, personId) {
    const { adj, across } = Eng.computeAdjacency(layout);
    const byChair = {}; for (const [p, c] of Object.entries(assignment || {})) byChair[c] = p;
    const cid = assignment && assignment[personId]; const out = { left: null, right: null, also: [], across: [] };
    if (!cid || !adj.has(cid)) return out;
    const cs = new Map(layout.chairs.map((c) => [c.id, c])); const me = cs.get(cid);
    const tb = layout.tables.find((t) => t.id === me.tableId);
    const a = Eng.facing(me, tb); const r = [Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2)];
    const L = [], R = [];
    for (const n of adj.get(cid)) {
      const o = cs.get(n); const p = byChair[n]; if (!p) continue;
      const vx = o.x - me.x, vy = o.y - me.y; const dot = vx * r[0] + vy * r[1]; const d = Math.hypot(vx, vy);
      (dot >= 0 ? R : L).push({ p, d });
    }
    L.sort((x, y) => x.d - y.d); R.sort((x, y) => x.d - y.d);
    out.left = L.length ? L[0].p : null; out.right = R.length ? R[0].p : null;
    out.also = [...L.slice(1), ...R.slice(1)].map((x) => x.p);
    out.across = [...(across.get(cid) || [])].map((c) => byChair[c]).filter(Boolean);
    return out;
  }

  /** Greedy non-overlapping label placement. items: [{id,x,y,w,h,cw,ch}] (cw/ch = compact size). */
  function placeLabels(items, bounds) {
    const placed = [], out = [];
    const pad = 3;
    const hit = (r) => placed.some((q) => r.x0 < q.x1 + pad && r.x1 + pad > q.x0 && r.y0 < q.y1 + pad && r.y1 + pad > q.y0);
    const inB = (r) => !bounds || (r.x0 >= bounds.x0 && r.x1 <= bounds.x1 && r.y0 >= bounds.y0 && r.y1 <= bounds.y1);
    for (const it of items) {
      let done = null;
      for (const compact of [false, true]) {
        const w = compact ? it.cw : it.w, h = compact ? it.ch : it.h;
        const offs = [[0, 0], [0, -(h + 4)], [0, h + 4], [w / 2 + 6, 0], [-(w / 2 + 6), 0], [0, -2 * (h + 4)], [0, 2 * (h + 4)], [w / 2 + 6, -(h + 4)], [-(w / 2 + 6), -(h + 4)], [w / 2 + 6, h + 4], [-(w / 2 + 6), h + 4]];
        for (const [dx, dy] of offs) {
          const cx = it.x + dx, cy = it.y + dy;
          const r = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
          if (!hit(r) && inB(r)) { placed.push(r); done = { id: it.id, x: cx, y: cy, compact, moved: dx !== 0 || dy !== 0 }; break; }
        }
        if (done) break;
      }
      out.push(done || { id: it.id, hidden: true });
    }
    return out;
  }

  // ---------- Three.js viewer (browser only) ----------
  let T = null;
  function woodTexture(base, grain, w, h, seed) {
    const cv = document.createElement('canvas'); cv.width = w || 512; cv.height = h || 512; const g = cv.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, cv.width, cv.height);
    let s = seed || 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 90; i++) {
      const y = rnd() * cv.height; g.strokeStyle = grain; g.globalAlpha = 0.05 + rnd() * 0.12; g.lineWidth = 0.6 + rnd() * 2.2;
      g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= cv.width; x += 32) g.lineTo(x, y + Math.sin(x / (40 + rnd() * 60) + i) * (2 + rnd() * 5)); g.stroke();
    }
    g.globalAlpha = 1; const tex = new T.CanvasTexture(cv); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.encoding = T.sRGBEncoding; tex.anisotropy = 4; return tex;
  }
  function rugTexture() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
    g.fillStyle = '#E9E1D3'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#D8CBB4'; g.lineWidth = 6; g.strokeRect(14, 14, 228, 228); g.lineWidth = 2; g.strokeRect(26, 26, 204, 204);
    const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; return tex;
  }
  function roundedRectShape(w, d, r) {
    const s = new T.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
  }

  class Viewer {
    constructor(opts) {
      T = root.THREE; this.opts = opts || {};
      const r = this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(2, root.devicePixelRatio || 1)); r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
      r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.08;
      r.domElement.className = 'v3d-canvas';
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(38, 1, 0.05, 80);
      this.controls = new T.OrbitControls(this.camera, r.domElement);
      Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: Math.PI / 2.08, minDistance: 1.2, maxDistance: 30, screenSpacePanning: true, rotateSpeed: 0.7 });
      this.controls.addEventListener('change', () => this.request());
      this.controls.addEventListener('start', () => { this.tween = null; });
      this.labelsEl = document.createElement('div'); this.labelsEl.className = 'v3d-labels';
      this.furniture = new T.Group(); this.decor = new T.Group(); this.scene.add(this.furniture, this.decor);
      this.mats = this.makeMaterials(); this.geo = this.makeGeometries();
      this.lights(); this.floor();
      this.chairObjs = new Map(); this.labels = new Map(); this.sizeCache = new Map();
      this.layoutSig = ''; this.data = null; this.reveal = 1; this.revealOrder = new Map();
      this.ray = new T.Raycaster(); this.ptr = new T.Vector2();
      r.domElement.addEventListener('pointerdown', (e) => { this.down = [e.clientX, e.clientY]; });
      r.domElement.addEventListener('pointerup', (e) => { if (this.down && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) < 6) this.pick(e); this.down = null; });
      this.labelsEl.addEventListener('click', (e) => { const l = e.target.closest('[data-chair]'); if (l && this.opts.onPick) this.opts.onPick(l.dataset.chair); });
      this.ro = new ResizeObserver(() => this.resize());
    }
    makeMaterials() {
      const tableWood = woodTexture('#A0703F', '#5C3A1C', 1024, 512, 11); tableWood.repeat.set(1, 1);
      const chairWood = woodTexture('#6B4527', '#2E1B0C', 256, 256, 5);
      const M = (o) => new T.MeshStandardMaterial(o);
      return {
        table: M({ map: tableWood, roughness: 0.48, metalness: 0.02 }), leg: M({ map: chairWood, roughness: 0.55 }),
        chair: M({ map: chairWood, roughness: 0.55 }), cushion: M({ color: 0xE9E1D2, roughness: 0.95 }),
        cushionMe: M({ color: 0xC5A352, roughness: 0.6, emissive: 0x3a2a05, emissiveIntensity: 0.6 }), cushionSel: M({ color: 0x2A2724, roughness: 0.8 }),
        cushionNb: M({ color: 0xE3CC8A, roughness: 0.8 }), ghost: M({ color: 0xB9B2A6, transparent: true, opacity: 0.28, roughness: 1 }),
        plate: M({ color: 0xFBFAF7, roughness: 0.28 }), rim: M({ color: 0xC5A352, roughness: 0.3, metalness: 0.7 }),
        metal: M({ color: 0xE4E2DD, roughness: 0.28, metalness: 0.75 }), glass: new T.MeshStandardMaterial({ color: 0xF4F7F8, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false }),
        wine: M({ color: 0x6E1E2B, roughness: 0.2, transparent: true, opacity: 0.85 }),
        runner: M({ color: 0xEFE8DB, roughness: 0.95 }), candle: M({ color: 0xFFFDF6, roughness: 0.7 }),
        flame: new T.MeshBasicMaterial({ color: 0xFFC163 }), brass: M({ color: 0xC9A65C, roughness: 0.32, metalness: 0.85 }),
        challah: M({ color: 0xBF7A35, roughness: 0.62 }), board: M({ map: chairWood, roughness: 0.6 }),
        leaf: M({ color: 0x6E8A5A, roughness: 0.8 }), bloom: M({ color: 0xF4F0E8, roughness: 0.9 }), vase: M({ color: 0xE8E4DC, roughness: 0.35 }),
      };
    }
    makeGeometries() {
      const G = T;
      return {
        seat: new G.BoxGeometry(0.44, 0.045, 0.44), cushion: new G.BoxGeometry(0.4, 0.035, 0.4), leg: new G.BoxGeometry(0.035, 0.45, 0.035),
        post: new G.BoxGeometry(0.035, 0.5, 0.035), back: new G.BoxGeometry(0.035, 0.3, 0.42), rail: new G.BoxGeometry(0.03, 0.04, 0.42),
        plate: new G.CylinderGeometry(0.13, 0.11, 0.016, 40), well: new G.CylinderGeometry(0.085, 0.085, 0.004, 32), rim: new G.TorusGeometry(0.122, 0.0035, 6, 48),
        fork: new G.BoxGeometry(0.018, 0.005, 0.19), knife: new G.BoxGeometry(0.016, 0.005, 0.21),
        glass: new G.CylinderGeometry(0.035, 0.028, 0.12, 20, 1, true), glassBase: new G.CylinderGeometry(0.03, 0.03, 0.006, 20), wine: new G.CylinderGeometry(0.03, 0.026, 0.045, 16),
        tLeg: new G.CylinderGeometry(0.03, 0.022, TOP_Y - TOP_T, 12),
      };
    }
    lights() {
      const s = this.scene;
      s.add(new T.HemisphereLight(0xFFF3E2, 0x6B5A48, 0.62));
      const sun = this.sun = new T.DirectionalLight(0xFFF1DE, 1.05); sun.position.set(-3, 7, 4.5); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.radius = 4; s.add(sun, sun.target);
      const fill = new T.DirectionalLight(0xDDE6FF, 0.25); fill.position.set(4, 3, -4); s.add(fill);
    }
    floor() {
      const shadow = new T.Mesh(new T.PlaneGeometry(60, 60), new T.ShadowMaterial({ opacity: 0.22 })); shadow.rotation.x = -Math.PI / 2; shadow.receiveShadow = true; this.scene.add(shadow);
      this.rug = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshStandardMaterial({ map: rugTexture(), roughness: 1 })); this.rug.rotation.x = -Math.PI / 2; this.rug.position.y = 0.002; this.rug.receiveShadow = true; this.scene.add(this.rug);
    }
    attach(el) {
      if (this.el === el) return; this.el = el;
      el.appendChild(this.renderer.domElement); el.appendChild(this.labelsEl);
      this.ro.disconnect(); this.ro.observe(el); this.resize(); this.request();
    }
    resize() {
      if (!this.el) return; const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
      this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.request();
    }
    clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }
    build(sp) {
      const M = this.mats, Gm = this.geo; this.clearGroup(this.furniture); this.clearGroup(this.decor); this.chairObjs.clear();
      for (const lt of (this.candleLights || [])) this.scene.remove(lt); this.candleLights = [];
      const mesh = (g, m, parent, shadow) => { const o = new T.Mesh(g, m); o.castShadow = shadow !== false; o.receiveShadow = true; (parent || this.furniture).add(o); return o; };
      sp.tables.forEach((t, ti) => {
        const grp = new T.Group(); grp.position.set(t.x, 0, t.z); grp.rotation.y = t.rotY; this.furniture.add(grp);
        if (t.shape === 'rect') {
          const g = new T.ExtrudeGeometry(roundedRectShape(t.w, t.d, 0.035), { depth: TOP_T, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 });
          g.rotateX(Math.PI / 2); g.translate(0, TOP_Y, 0);
          const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * 0.9);
          mesh(g, M.table, grp);
          for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const l = mesh(Gm.tLeg, M.leg, grp); l.position.set(lx * (t.w / 2 - 0.07), (TOP_Y - TOP_T) / 2, lz * (t.d / 2 - 0.07)); }
          const apron = mesh(new T.BoxGeometry(t.w - 0.16, 0.08, t.d - 0.16), M.leg, grp); apron.position.y = TOP_Y - TOP_T - 0.04;
          // runner along the long side
          const runner = mesh(new T.BoxGeometry(t.w - 0.08, 0.002, Math.min(0.3, t.d * 0.32)), M.runner, null, false); runner.receiveShadow = true;
          runner.position.set(0, TOP_Y + 0.002, 0); const rg = new T.Group(); rg.position.copy(grp.position); rg.rotation.y = grp.rotation.y; rg.add(runner); this.decor.add(rg);
        } else {
          const r = t.w / 2; const top = mesh(new T.CylinderGeometry(r, r, TOP_T, 64), M.table, grp); top.position.y = TOP_Y - TOP_T / 2; top.scale.z = t.d / t.w;
          const ped = mesh(new T.CylinderGeometry(0.07, 0.1, TOP_Y - TOP_T, 20), M.leg, grp); ped.position.y = (TOP_Y - TOP_T) / 2;
          const foot = mesh(new T.CylinderGeometry(0.32, 0.36, 0.04, 32), M.leg, grp); foot.position.y = 0.02; foot.scale.z = Math.min(1, (t.d / t.w) * 1.4);
        }
        // centerpiece: Shabbat candles + challah on the first table, flowers elsewhere
        const cg = new T.Group(); cg.position.set(t.x, TOP_Y, t.z); cg.rotation.y = t.rotY; this.decor.add(cg);
        if (ti === 0) {
          for (const dx of [-0.12, 0.12]) {
            const b = mesh(new T.CylinderGeometry(0.035, 0.05, 0.02, 20), M.brass, cg); b.position.set(dx, 0.01, -0.02);
            const st = mesh(new T.CylinderGeometry(0.012, 0.016, 0.17, 12), M.brass, cg); st.position.set(dx, 0.1, -0.02);
            const cup = mesh(new T.CylinderGeometry(0.022, 0.014, 0.025, 14), M.brass, cg); cup.position.set(dx, 0.195, -0.02);
            const c = mesh(new T.CylinderGeometry(0.011, 0.011, 0.15, 12), M.candle, cg); c.position.set(dx, 0.28, -0.02);
            const f = mesh(new T.ConeGeometry(0.009, 0.03, 10), M.flame, cg, false); f.position.set(dx, 0.37, -0.02);
          }
          const pl = new T.PointLight(0xFFB65C, 0.55, 3.2, 2); pl.position.set(t.x, TOP_Y + 0.45, t.z); this.scene.add(pl); this.candleLights.push(pl);
          if (t.shape === 'rect' && t.w > 1.0 || t.shape !== 'rect' && t.w > 1.1) {
            const bd = mesh(new T.BoxGeometry(0.34, 0.02, 0.2), M.board, cg); bd.position.set(0.42 * (t.shape === 'rect' ? 1 : 0.6), 0.01, 0.02);
            for (const k of [-1, 0, 1]) { const s = mesh(new T.SphereGeometry(0.05, 16, 12), M.challah, cg); s.position.set(bd.position.x + k * 0.085, 0.055, 0.02); s.scale.set(1.25, 0.75, 0.95); }
          }
        } else {
          const v = mesh(new T.CylinderGeometry(0.045, 0.035, 0.14, 20), M.vase, cg); v.position.y = 0.07;
          for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const b = mesh(new T.SphereGeometry(0.032, 10, 8), i % 2 ? M.bloom : M.leaf, cg); b.position.set(Math.cos(a) * 0.045, 0.18 + (i % 3) * 0.015, Math.sin(a) * 0.045); }
        }
      });
      // chairs + place settings (same chair ids as the 2D plan and the engine)
      for (const c of sp.chairs) {
        const g = new T.Group(); g.position.set(c.x, 0, c.z); g.rotation.y = c.rotY; g.userData.chairId = c.id;
        const mat = c.disabled ? M.ghost : M.chair;
        const add = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = !c.disabled; o.receiveShadow = true; o.userData.chairId = c.id; g.add(o); return o; };
        for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [0.18, 0.18], [-0.18, 0.18]]) add(Gm.leg, mat, lx, 0.225, lz);
        add(Gm.seat, mat, 0, 0.47, 0);
        const cushion = add(Gm.cushion, c.disabled ? M.ghost : M.cushion, 0.01, 0.51, 0);
        for (const lz of [-0.19, 0.19]) add(Gm.post, mat, -0.2, 0.72, lz);   // back uprights (away from the table)
        add(Gm.back, mat, -0.2, 0.8, 0); add(Gm.rail, mat, -0.2, 0.96, 0);
        this.furniture.add(g); this.chairObjs.set(c.id, { group: g, cushion, spec: c });
        if (c.setting) {
          const s = c.setting, Y = TOP_Y;
          const p = mesh(Gm.plate, M.plate, this.decor); p.position.set(s.plate[0], Y + 0.008, s.plate[1]);
          const rim = mesh(Gm.rim, M.rim, this.decor, false); rim.rotation.x = Math.PI / 2; rim.position.set(s.plate[0], Y + 0.0165, s.plate[1]);
          const f = mesh(Gm.fork, M.metal, this.decor); f.position.set(s.fork[0], Y + 0.003, s.fork[1]); f.rotation.y = c.rotY + Math.PI / 2;
          const k = mesh(Gm.knife, M.metal, this.decor); k.position.set(s.knife[0], Y + 0.003, s.knife[1]); k.rotation.y = c.rotY + Math.PI / 2;
          const gl = mesh(Gm.glass, M.glass, this.decor, false); gl.position.set(s.glass[0], Y + 0.07, s.glass[1]);
          const gb = mesh(Gm.glassBase, M.glass, this.decor, false); gb.position.set(s.glass[0], Y + 0.003, s.glass[1]);
          const wn = mesh(Gm.wine, M.wine, this.decor, false); wn.position.set(s.glass[0], Y + 0.03, s.glass[1]);
        }
      }
      // rug + shadow camera sized to the arrangement
      const b = sp.bounds, wx = b.x1 - b.x0 + 1.4, wz = b.z1 - b.z0 + 1.4;
      this.rug.scale.set(wx, wz, 1); this.rug.position.set(b.cx, 0.002, b.cz);
      const sc = this.sun.shadow.camera, R = Math.max(wx, wz) / 2 + 1;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = 25; sc.updateProjectionMatrix();
      this.sun.position.set(b.cx - 3, 7, b.cz + 4.5); this.sun.target.position.set(b.cx, 0, b.cz);
      this.sp = sp;
    }
    setData(d) {
      const sig = JSON.stringify([d.layout.tables, d.layout.chairs.map((c) => [c.id, Math.round(c.x), Math.round(c.y), c.tableId, !!c.disabled])]);
      const keyChanged = d.key !== this.key; this.key = d.key;
      if (sig !== this.layoutSig) { this.layoutSig = sig; this.build(spec(d.layout)); if (keyChanged || d.refit) this.setView(keyChanged ? 'iso' : (this.view || 'iso'), false); }
      else if (keyChanged) this.setView('iso', false);
      this.data = d; this.decor.visible = d.detail !== false;
      this.syncLabels(); this.paint(); this.request();
    }
    paint() {
      const d = this.data, M = this.mats; if (!d) return;
      const hl = new Set(d.highlight || []);
      const meChair = d.me && d.assign && d.assign[d.me];
      this.chairObjs.forEach((o, id) => {
        if (o.spec.disabled) return;
        o.cushion.material = id === d.sel ? M.cushionSel : id === meChair ? M.cushionMe : hl.has(id) ? M.cushionNb : M.cushion;
      });
    }
    syncLabels() {
      const d = this.data; const pById = new Map((d.people || []).map((p) => [p.id, p]));
      const want = new Map(); if (d.assign) for (const [pid, cid] of Object.entries(d.assign)) if (this.chairObjs.has(cid) && pById.has(pid)) want.set(cid, pById.get(pid));
      for (const [cid, el] of this.labels) if (!want.has(cid)) { el.remove(); this.labels.delete(cid); }
      const hl = new Set(d.highlight || []); const meChair = d.me && d.assign && d.assign[d.me];
      for (const [cid, p] of want) {
        let el = this.labels.get(cid);
        const html = `${p.photo ? `<img src="${p.photo}" alt="">` : ''}<span class="full"></span><span class="ini"></span>`;
        if (!el || el.dataset.pid !== p.id) {
          if (el) el.remove(); el = document.createElement('button'); el.type = 'button'; el.className = 'lbl'; el.dataset.chair = cid; el.dataset.pid = p.id; el.innerHTML = html;
          el.querySelector('.full').textContent = p.name; el.querySelector('.ini').textContent = this.opts.initials ? this.opts.initials(p.name) : p.name[0];
          el.setAttribute('aria-label', p.name); this.labelsEl.appendChild(el); this.labels.set(cid, el);
        }
        el.classList.toggle('me', cid === meChair); el.classList.toggle('sel', cid === d.sel); el.classList.toggle('nb', hl.has(cid));
        el.classList.toggle('dim', !!d.dim && cid !== meChair && !hl.has(cid) && cid !== d.sel);
      }
      // reveal order: around the arrangement centre
      if (this.sp) { const b = this.sp.bounds; const ids = [...want.keys()].sort((a, c) => { const A = this.chairObjs.get(a).spec, C = this.chairObjs.get(c).spec; return Math.atan2(A.z - b.cz, A.x - b.cx) - Math.atan2(C.z - b.cz, C.x - b.cx); }); this.revealOrder = new Map(ids.map((id, i) => [id, i / Math.max(1, ids.length)])); }
    }
    layoutLabels() {
      if (!this.el || !this.labels.size) return;
      const W = this.el.clientWidth, H = this.el.clientHeight; const v = new T.Vector3(); const items = [];
      const meChair = this.data.me && this.data.assign && this.data.assign[this.data.me];
      for (const [cid, el] of this.labels) {
        const sp = this.chairObjs.get(cid).spec; v.set(sp.label[0], sp.label[1], sp.label[2]).project(this.camera);
        if (v.z > 1) { el.style.opacity = 0; continue; }
        let sz = this.sizeCache.get(el.dataset.pid);
        if (!sz) { el.classList.add('measure'); const f = el.querySelector('.full'), i = el.querySelector('.ini'); i.style.display = 'none'; const w = el.offsetWidth, h = el.offsetHeight; i.style.display = ''; f.style.display = 'none'; const cw = el.offsetWidth, ch = el.offsetHeight; f.style.display = ''; el.classList.remove('measure'); sz = { w, h, cw, ch }; this.sizeCache.set(el.dataset.pid, sz); }
        const prio = cid === meChair ? -2 : cid === this.data.sel ? -1 : v.z;
        items.push({ id: cid, x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, w: sz.w, h: sz.h, cw: sz.cw, ch: sz.ch, prio });
      }
      items.sort((a, b) => a.prio - b.prio);
      const res = placeLabels(items, { x0: 2, y0: 2, x1: W - 2, y1: H - 2 });
      const hidden = res.filter((r) => r.hidden).length;
      if (!this.hiddenEl) { this.hiddenEl = document.createElement('div'); this.hiddenEl.className = 'v3d-hidden'; this.labelsEl.appendChild(this.hiddenEl); }
      this.hiddenEl.textContent = hidden && this.reveal >= 1 && this.opts.hiddenText ? this.opts.hiddenText(hidden) : '';
      this.hiddenEl.style.display = this.hiddenEl.textContent ? '' : 'none';
      for (const r of res) {
        const el = this.labels.get(r.id);
        if (r.hidden) { el.style.opacity = 0; el.style.pointerEvents = 'none'; continue; }
        const rv = this.revealOrder.get(r.id) || 0; const shown = this.reveal >= 1 || this.reveal > rv;
        el.classList.toggle('compact', r.compact); el.classList.toggle('moved', r.moved);
        el.style.transform = `translate(${(r.x).toFixed(1)}px,${(r.y).toFixed(1)}px) translate(-50%,-50%)${shown ? '' : ' scale(.6)'}`;
        el.style.opacity = shown ? 1 : 0; el.style.pointerEvents = shown ? 'auto' : 'none';
      }
    }
    pick(e) {
      const rc = this.renderer.domElement.getBoundingClientRect();
      this.ptr.set((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
      this.ray.setFromCamera(this.ptr, this.camera);
      const hit = this.ray.intersectObjects(this.furniture.children, true).find((h) => h.object.userData.chairId);
      if (this.opts.onPick) this.opts.onPick(hit ? hit.object.userData.chairId : null);
    }
    fit(kind) {
      const b = this.sp.bounds; const ex = b.x1 - b.x0, ez = b.z1 - b.z0; const R = Math.max(ex, ez) / 2 + 0.55;
      const fov = this.camera.fov * Math.PI / 180, asp = this.camera.aspect || 1;
      const longZ = ez > ex; const portrait = asp < 0.9;
      let dist = R / Math.tan(fov / 2) * (asp < 1.2 ? Math.min(2.2, 1.25 / asp) : 0.95);
      const target = new T.Vector3(b.cx, TOP_Y * 0.55, b.cz); let dir;
      if (kind === 'top') { dist *= portrait === longZ ? 1.02 : 1.12; dir = (portrait !== longZ) ? new T.Vector3(0.001, 1, 0) : new T.Vector3(0, 1, 0.001); target.y = TOP_Y * 0.5; }
      else if (kind === 'eye') { dir = longZ ? new T.Vector3(1, 0.32, 0.25) : new T.Vector3(0.25, 0.32, 1); dist *= 0.8; }
      else dir = longZ ? new T.Vector3(1, 0.95, 0.35) : new T.Vector3(0.35, 0.95, 1);
      return { pos: target.clone().add(dir.normalize().multiplyScalar(dist)), target };
    }
    setView(kind, animate, ms) {
      if (!this.sp) return; this.view = kind; const f = this.fit(kind);
      if (!animate) { this.camera.position.copy(f.pos); this.controls.target.copy(f.target); this.controls.update(); this.request(); return; }
      this.tweenTo(f, ms || 750);
    }
    tweenTo(f, ms, onDone) {
      const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
      const s0 = new T.Spherical().setFromVector3(p0.clone().sub(t0)), s1 = new T.Spherical().setFromVector3(f.pos.clone().sub(f.target));
      let dth = s1.theta - s0.theta; if (dth > Math.PI) dth -= 2 * Math.PI; if (dth < -Math.PI) dth += 2 * Math.PI;
      this.tween = { start: performance.now(), ms, step: (k) => {
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const tg = t0.clone().lerp(f.target, e); const s = new T.Spherical(s0.radius + (s1.radius - s0.radius) * e, s0.phi + (s1.phi - s0.phi) * e, s0.theta + dth * e);
        this.camera.position.copy(tg.clone().add(new T.Vector3().setFromSpherical(s))); this.controls.target.copy(tg);
      }, onDone };
      this.request();
    }
    /** Presentation: sweeping camera reveal, then names appear one by one. */
    intro(onDone) {
      if (!this.sp) return; const end = this.fit('iso');
      const b = this.sp.bounds; const t = new T.Vector3(b.cx, 0.4, b.cz);
      this.camera.position.copy(t.clone().add(new T.Vector3(-Math.max(6, (b.x1 - b.x0) * 1.6), 0.9, Math.max(3, (b.z1 - b.z0) * 1.4)))); this.controls.target.copy(t);
      this.reveal = 0; this.request();
      const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.tweenTo(end, reduce ? 10 : 2800, () => {
        const t1 = performance.now(), dur = reduce ? 10 : 1500;
        const tick = () => { this.reveal = Math.min(1, (performance.now() - t1) / dur); this.layoutLabels(); if (this.reveal < 1) requestAnimationFrame(tick); else if (onDone) onDone(); };
        tick();
      });
    }
    request() { if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); }
    frame() {
      this.raf = 0; if (!this.el || !this.el.isConnected) return;
      let more = false;
      if (this.tween) { const k = Math.min(1, (performance.now() - this.tween.start) / this.tween.ms); this.tween.step(k); if (k < 1) more = true; else { const cb = this.tween.onDone; this.tween = null; this.controls.update(); if (cb) cb(); } }
      if (this.controls.update()) more = true;
      this.renderer.render(this.scene, this.camera); this.layoutLabels();
      if (more) this.request();
    }
  }

  const api = { spec, sides, placeLabels, Viewer, SCALE: S, TOP_Y };
  root.Mazleg3D = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
