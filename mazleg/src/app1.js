'use strict';
const E = window.MazlegEngine;
const BASE_URL = '__BASE_URL__';
const KEY = 'mazleg:v1';
const app = document.getElementById('app');

// ---------- state ----------
const S = {
  lang: 'he', route: { name: 'home' }, store: null, draft: null, vote: null, remote: null,
  modal: null, toast: null, present: null, ui: { sel: null, showAdj: false, chairSel: null, busy: false, m3: { design: false, seat: false, result: true }, detail: true },
  chat: null, sample: undefined, linkCache: {},
};
function blankStore() { return { events: [], family: [], settings: {}, myVotes: {} }; }
function loadStore() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.events) return Object.assign(blankStore(), s); } catch (e) {}
  return blankStore();
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(S.store)); }
  catch (e) { toast(S.lang === 'he' ? 'האחסון במכשיר מלא — נסו להסיר תמונות.' : 'Device storage is full — try removing photos.'); }
}
S.store = loadStore();
S.lang = S.store.settings.lang || 'he';

// ---------- utils ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function t(k, v) {
  let s = (I18N[S.lang] && I18N[S.lang][k]) != null ? I18N[S.lang][k] : (I18N.en[k] != null ? I18N.en[k] : k);
  if (v) for (const [a, b] of Object.entries(v)) s = s.split('{' + a + '}').join(b);
  return s;
}
const rid = (n = 6) => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(n)); for (const x of r) s += a[x % a.length]; return s; };
const initials = (n) => { const p = String(n || '?').trim().split(/\s+/); return (p.length > 1 ? p[0][0] + p[p.length - 1][0] : p[0][0]).toUpperCase(); };
const shortName = (n) => { n = String(n || ''); if (n.length <= 11) return n; const f = n.split(/\s+/); return f.length > 1 && f[0].length >= 3 ? f[0] : n.slice(0, 10) + '…'; };
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T12:00').toLocaleDateString(S.lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return d; }
}
function av(p, size) {
  const s = size ? ` style="--s:${size}px"` : '';
  return `<span class="av"${s}>${p && p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p && p.name))}</span>`;
}
function toast(msg) {
  S.toast = msg; renderToast();
  clearTimeout(toast._t); toast._t = setTimeout(() => { S.toast = null; renderToast(); }, 2600);
}
function renderToast() {
  let el = document.getElementById('toast');
  if (!S.toast) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = S.toast;
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); toast(t('copied')); return; } catch (e) {}
  const ta = document.createElement('textarea'); ta.value = s; ta.style.cssText = 'position:fixed;opacity:0;top:0';
  document.body.appendChild(ta); ta.select(); let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove(); toast(ok ? t('copied') : t('copyFail'));
}
async function nativeShare(title, text, url) {
  if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  copyText(url);
}
const waHref = (text) => 'https://wa.me/?text=' + encodeURIComponent(text);

// ---------- compact link encoding (hash names allow only letters, digits and hyphens) ----------
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => { if (!/^[0-9a-f]*$/.test(s) || s.length % 2) throw new Error('bad'); const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; };
async function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  try {
    if (window.CompressionStream) {
      const st = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 'z' + hex(new Uint8Array(await new Response(st).arrayBuffer()));
    }
  } catch (e) {}
  return 'h' + hex(bytes);
}
async function unpack(str) {
  const mode = str[0]; let b = unhex(str.slice(1));
  if (mode === 'z') { const st = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw')); b = new Uint8Array(await new Response(st).arrayBuffer()); }
  else if (mode !== 'h') throw new Error('bad');
  return JSON.parse(new TextDecoder().decode(b));
}
function linkBase() { const b = S.store.settings.baseUrl || (BASE_URL.startsWith('http') ? BASE_URL : '') || location.href.split('#')[0]; return b.split('#')[0]; }
async function makeLink(kind, payload) { return linkBase() + '#' + kind + '-' + (await pack(payload)); }

// ---------- icons (lucide-style strokes) ----------
const IC = {
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  rot: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  spark: '<path d="M12 3l1.9 5.8L20 10.7l-5.8 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>', search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  back: '<path d="m15 18-6-6 6-6"/>', fwd: '<path d="m9 18 6-6-6-6"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  table: '<rect x="3" y="8" width="18" height="8" rx="2"/><circle cx="7" cy="4.5" r="1.5"/><circle cx="12" cy="4.5" r="1.5"/><circle cx="17" cy="4.5" r="1.5"/><circle cx="7" cy="19.5" r="1.5"/><circle cx="12" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  chair: '<circle cx="12" cy="12" r="6"/>', box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>', clip: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>', eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  cam: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
};
const ic = (n, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ''}>${IC[n]}</svg>`;
const flip = (n) => (S.lang === 'he' ? (n === 'back' ? 'fwd' : n === 'fwd' ? 'back' : n) : n);

// ---------- event helpers ----------
const evById = (id) => S.store.events.find((e) => e.id === id);
const pById = (ev, id) => ev.participants.find((p) => p.id === id);
const activeSeats = (layout) => (layout ? layout.chairs.filter((c) => !c.disabled).length : 0);
function evStatus(ev) {
  if (ev.plan && ev.plan.publishedAt) return 'published';
  if (ev.plan && ev.plan.assignment) return 'seated';
  return ev.votingOpen ? 'voting' : 'closed';
}
function statusPill(ev) {
  const s = evStatus(ev); const cls = s === 'published' || s === 'seated' ? 'ok' : s === 'voting' ? 'gold' : '';
  return `<span class="pill ${cls}"><span class="dot"></span>${t('st_' + s)}</span>`;
}
const voteCount = (ev) => ev.participants.filter((p) => ev.votes[p.id]).length;
function typeLabel(ev) { return ev.type === 'custom' ? (ev.customType || t('t_custom')) : t('t_' + ev.type); }

function engineInput(ev) {
  const prefs = {};
  for (const p of ev.participants) if (ev.votes[p.id]) prefs[p.id] = ev.votes[p.id].choices;
  const locks = {};
  if (ev.plan && ev.plan.assignment) {
    const byChair = {}; for (const [pid, cid] of Object.entries(ev.plan.assignment)) byChair[cid] = pid;
    for (const cid of ev.plan.locked || []) if (byChair[cid] && pById(ev, byChair[cid])) locks[byChair[cid]] = cid;
  }
  const rules = ev.rules || [];
  return {
    people: ev.participants.map((p) => ({ id: p.id })), prefs, layout: ev.layout,
    constraints: { locks, together: rules.filter((r) => r.kind === 'together').map((r) => [r.a, r.b]), apart: rules.filter((r) => r.kind === 'apart').map((r) => [r.a, r.b]) },
  };
}

// ---------- layout builders ----------
function buildLayout(mode, c) {
  switch (mode) {
    case 'rect': return E.connectedRect({ tables: 1, seatsPerSide: c.perSide, headSeats: c.heads, orientation: c.orient });
    case 'round': return E.roundTable(0, 0, c.seats, false);
    case 'oval': return E.roundTable(0, 0, c.seats, true);
    case 'separate': return E.separateTables(c.count, c.seatsEach, false);
    default: return E.connectedRect({ tables: c.tables, seatsPerSide: c.perSide, headSeats: c.heads, orientation: c.orient });
  }
}
function suggestCfg(n) {
  n = Math.max(2, n || 10);
  const tables = n <= 8 ? 1 : n <= 14 ? 2 : n <= 24 ? 3 : Math.ceil(n / 8);
  const perSide = Math.max(1, Math.ceil((n - 2) / (2 * tables)));
  return { tables, perSide, heads: true, orient: 'horizontal', seats: Math.max(4, n), count: Math.max(2, Math.ceil(n / 8)), seatsEach: Math.min(10, Math.max(4, Math.ceil(n / Math.max(2, Math.ceil(n / 8))))) };
}
function fitCfg(mode, c, n) {
  // keep the shape the organizer chose but make sure everyone fits
  const cap = () => activeSeats(buildLayout(mode, c));
  let guard = 0;
  while (cap() < n && guard++ < 60) {
    if (mode === 'round' || mode === 'oval') c.seats++;
    else if (mode === 'separate') c.seatsEach < 10 ? c.seatsEach++ : c.count++;
    else c.perSide++;
  }
  return c;
}

// ---------- photo ----------
function resizePhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = 160, cv = document.createElement('canvas'); cv.width = s; cv.height = s;
      const m = Math.min(img.width, img.height), ctx = cv.getContext('2d');
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
      URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = rej; img.src = url;
  });
}
