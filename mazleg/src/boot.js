// ---------- boot ----------
(async function boot() {
  if (typeof SERVER !== 'undefined' && SERVER) { bootServer(); return; }
  if (!(await handleHash())) render();
  try { if (window.claude && window.claude.use) { const s = await window.claude.use('sample'); S.sample = s || null; if (S.modal && S.modal.kind === 'chat') render(); } else S.sample = null; } catch (e) { S.sample = null; }
})();
