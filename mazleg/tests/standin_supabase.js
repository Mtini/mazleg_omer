// Test stand-in for @supabase/supabase-js: same call shapes the app uses (auth.*, rpc), talking to standin_server.py.
(function () {
  function createClient(url, key) {
    const K = 'sb-standin-session'; const listeners = [];
    const get = () => { try { return JSON.parse(localStorage.getItem(K)); } catch (e) { return null; } };
    const post = async (path, body, token) => {
      const r = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + (token || key) }, body: JSON.stringify(body) });
      const j = await r.json(); return r.ok ? { data: j, error: null } : { data: null, error: j };
    };
    const login = (r) => { if (r.error) return { data: { session: null }, error: { message: r.error.message } }; const s = { access_token: r.data.access_token, user: r.data.user }; localStorage.setItem(K, JSON.stringify(s)); listeners.forEach((f) => f('SIGNED_IN', s)); return { data: { session: s, user: s.user }, error: null }; };
    return {
      auth: {
        getSession: async () => ({ data: { session: get() } }),
        signUp: async ({ email, password }) => login(await post('/auth/v1/signup', { email, password })),
        signInWithPassword: async ({ email, password }) => login(await post('/auth/v1/token', { email, password })),
        signOut: async () => { localStorage.removeItem(K); listeners.forEach((f) => f('SIGNED_OUT', null)); return { error: null }; },
        resetPasswordForEmail: async () => ({ data: {}, error: null }),
        onAuthStateChange: (f) => { listeners.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
      },
      rpc: async (name, args) => post('/rest/v1/rpc/' + name, args, (get() || {}).access_token),
    };
  }
  window.supabase = { createClient };
})();
