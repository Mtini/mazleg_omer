// MAZLEG assistant — server-side Claude calls. The API key lives only in Supabase secrets.
// Deploy:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   &&   supabase functions deploy assistant
// Guests authenticate with their participant session; organizers with their Supabase JWT.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-5-5';
const ALLOWED_ORIGIN = Deno.env.get('PUBLIC_SITE_URL') ?? '*';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Msg = { role: 'me' | 'bot'; text: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 503);

  let body: { mode?: string; session?: string; familyId?: string; eventId?: string; messages?: Msg[]; lang?: string; selected?: string[] };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const messages = (body.messages ?? []).slice(-12).map((m) => ({ role: m.role === 'me' ? 'Person' : 'Mazleg', text: String(m.text ?? '').slice(0, 800) }));
  const lang = body.lang === 'en' ? 'English' : 'Hebrew';
  const transcript = messages.map((m) => `${m.role}: ${m.text}`).join('\n');
  let prompt = '';
  let allowedIds = new Set<string>();

  if (body.mode === 'voter') {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc('assistant_voter_context', { p_session: body.session ?? '' });
    if (error || !data) return json({ error: 'invalid_session' }, 401);
    const others = (data.participants as { id: string; name: string }[]).filter((p) => p.id !== data.me);
    allowedIds = new Set(others.map((p) => p.id));
    const selected = (body.selected ?? []).map((id) => others.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || 'nobody';
    prompt = `You are MAZLEG (מזלג), a warm, playful, brief seating helper shaped like a friendly golden fork with a moustache. You help ONE family member decide who to sit next to at "${data.event}". They may pick up to two people.
Hard rules: never claim you submitted or changed anything — the person must tap a button to select and then confirm. Never invent relationships, history or preferences. Never guess sensitive personal information. Never rank or suggest people by age. Only suggest people the person named or clearly described; if they ask you to just pick, ask a gentle question instead. Only the organizer sees choices.
Reply in ${lang}, at most 3 short sentences, no emoji.
Guests (id: name): ${others.map((p) => `${p.id}: ${p.name}`).join('; ')}
Currently selected: ${selected}
Conversation:
${transcript}
Return ONLY JSON: {"reply": string, "suggest": [ids of at most 2 guests the person named, else empty]}`;
  } else if (body.mode === 'organizer') {
    const auth = req.headers.get('Authorization') ?? '';
    const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: ws, error } = await user.rpc('get_workspace', { p_family: body.familyId });   // authorizes the organizer
    if (error || !ws) return json({ error: 'not_authorized' }, 403);
    const ev = (ws.events as any[]).find((e) => e.id === body.eventId);
    if (!ev || !ev.plan) return json({ error: 'not_found' }, 404);
    const nm = (id: string) => ev.participants.find((p: any) => p.id === id)?.name ?? '?';
    const st = ev.plan.current?.stats ?? {};
    const per = Object.entries(ev.plan.current?.perPerson ?? {}).map(([id, x]: any) => `${nm(id)}: ${x.fulfilled}/${x.requested}`).join('; ');
    prompt = `You are MAZLEG (מזלג), the assistant of a family seating app. The organizer asks about a plan produced by a dedicated optimization engine. You EXPLAIN and SUGGEST; you never assign seats. Organizer tools: Re-arrange, lock a seat, swap, "sit together"/"keep apart" rules, add chairs, compare alternatives. Do not invent relationships. Do not use age as a criterion.
Reply in ${lang}, max 5 short sentences, no emoji.
Facts: ${st.fulfilled}/${st.total} requests fulfilled; ${st.mutualMet}/${st.mutualPairs} mutual pairs together; ${st.votersWithNone} got none. Per person: ${per}.
Conversation:
${transcript}
Return ONLY JSON: {"reply": string}`;
  } else return json({ error: 'bad_request' }, 400);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) return json({ error: 'ai_unavailable' }, 502);
  const out = await r.json();
  const text: string = (out.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  let parsed: { reply?: string; suggest?: string[] } = {};
  try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { parsed = { reply: text.trim() }; }
  return json({ reply: String(parsed.reply ?? '').slice(0, 900), suggest: (parsed.suggest ?? []).filter((id) => allowedIds.has(id)).slice(0, 2) });
});
