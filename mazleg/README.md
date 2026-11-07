# MAZLEG · מזלג — Every seat has a story.

Multi-family smart seating. Each family has a private workspace; each dinner has its own invitation link;
guests vote from their phones without an account; a seating engine arranges the table; a 3D table shows the result.

## What's in this repository

| Path | What it is |
|---|---|
| `src/` | The app (vanilla JS, no framework): seating engine, 3D table, UI, production data layer (`app8-server.js`) |
| `supabase/migrations/` | Postgres schema, Row Level Security, and all server-side functions |
| `supabase/tests/database/` | pgTAP suite: 50 assertions covering cross-family isolation and invitation security |
| `supabase/functions/assistant/` | Edge Function that calls Claude. The API key lives only in Supabase secrets |
| `public/` | PWA manifest, service worker, icons, iOS splash screens, official logo |
| `scripts/build.mjs` | Zero-dependency build → `dist/` |
| `tests/` | Engine + 3D unit tests (Node), and a browser journey test (Playwright) |

## Security model (read this first)

* **Every row belongs to one family**, directly (`families`, `family_members`, `events`) or through its event
  (participants, tables, seats, invitations, preferences, arrangements).
* **RLS is enabled on every table.** Organizers can only `SELECT` rows of families they organize. `anon` has no
  table access at all. **No client role can write tables directly** — every write goes through a
  `SECURITY DEFINER` function that checks authorization first (`private.assert_organizer`).
* **Guests never get accounts or workspace access.** An invitation token (192-bit, per event) lets them see the
  participant *names* for that one dinner. Choosing a name issues a participant session secret; only its SHA-256
  hash is stored. A name claimed on one phone can't be taken from another phone (the organizer can release it).
* **The database itself enforces** one active response per participant, at most two choices, no self-choice,
  one seat per person, one person per seat, and no assignments to unavailable seats.
* Invitation links can be **rotated** (old link stops working) or **revoked**.
* Other organizers join by a one-time code that expires after 7 days. Being invited to a dinner never grants workspace access.
* Service-role and Anthropic keys never reach the frontend; the build refuses to emit them.

## Demo mode

"Try the demo" on the welcome screen opens a sample family (17 people, a Friday dinner around 3 connected tables
with 14 of 17 choices in, and a past holiday dinner already arranged) — no account needed. Visitors can vote as a
family member, use the assistant, generate and edit the seating, open the 3D table and run the presentation.

**Isolation:** the demo runs entirely in the browser from its own dataset under its own storage key
(`mazleg:demo:v1`). While a demo session is active the Supabase client is wrapped so *no* RPC can leave the browser
(`demo_mode`), sync and live polling are off, and invitation links are replaced by on-device voting. A signed-in
organizer who opens the demo has pending changes saved first; their workspace is parked in memory and restored
untouched on exit. The demo never creates a database row, so the server-side security model is unchanged.
"Reset demo" restores the original sample; "Start my own family" leaves the demo and opens real sign-up.
In the production build the demo assistant uses the built-in helper (the AI function only serves real,
authenticated sessions, so it can't be used as an open proxy).

## Status — what was verified, and where

| Area | Status |
|---|---|
| Seating engine + 3D model logic | ✅ 18 unit tests pass (`npm test`) |
| Full multi-family journey in a browser (sign-up → family → 17-person dinner → link → phone votes → seating → publish → Family B → cross-family attacks → revoked/invalid links → mobile → PWA install check) | ✅ 32/32 checks pass (`tests/journey.py`) — **against a local stand-in server** that mirrors the SQL contract, not real Supabase |
| Demo mode: full exploration without an account, zero database/auth/function requests, reset, exit, real family unaffected | ✅ 23/23 checks pass (`tests/demo_journey.py`) |
| PWA: manifest, service worker, installability | ✅ Chromium's own `getInstallabilityErrors` returns none |
| SQL migration, RLS, server functions | ⚠️ **Written but not yet executed** — the build environment had no PostgreSQL. Run `supabase test db` first (below) |
| pgTAP isolation suite | ⚠️ **Written, not yet executed** — same reason |
| Claude assistant Edge Function | ⚠️ **Not executed** (no Deno/network). Without it, the app falls back to a clearly labelled basic helper |
| Real Supabase Auth emails, custom domain, HTTPS | ⏳ Needs your accounts — steps below |

## 1. Database (Supabase)

1. Create a project at supabase.com (region close to your families, e.g. Frankfurt `eu-central-1`).
2. Install the Supabase CLI and Docker, then from this folder:
   ```bash
   supabase init            # only if supabase/config.toml doesn't exist yet; keep the existing migrations
   supabase start           # local Postgres + Auth
   supabase db reset        # applies supabase/migrations
   supabase test db         # runs the 50 isolation assertions — all must pass before going live
   ```
   If anything fails, fix it locally before touching production.
3. Push to your project:
   ```bash
   supabase link --project-ref YOUR-PROJECT-REF
   supabase db push
   ```
4. Supabase dashboard → **Authentication → URL Configuration**: Site URL `https://mazleg.com`;
   Redirect URLs `https://mazleg.com/**`. Turn on email confirmation. For real-world email volume, add custom SMTP
   (the built-in sender is rate-limited).
5. Assistant (optional):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... PUBLIC_SITE_URL=https://mazleg.com CLAUDE_MODEL=claude-haiku-5-5
   supabase functions deploy assistant --no-verify-jwt   # the function authenticates guests/organizers itself
   ```

## 2. Hosting (Vercel shown; any static host works)

1. Push this folder to a Git repository and import it in Vercel. `vercel.json` already sets the build command,
   output folder, `/join/:token` routing, security headers and `www` → apex redirect.
2. Project → Settings → **Environment Variables** (Production):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the public anon/publishable key), `PUBLIC_SITE_URL=https://mazleg.com`.
   The build **refuses** preview addresses (`*.vercel.app`, `claude.ai`, `localhost`) as `PUBLIC_SITE_URL`, so
   invitation links can only ever use your domain.
3. Deploy. Netlify/Cloudflare Pages: build command `node scripts/build.mjs`, output `dist`; `public/_redirects` handles `/join/*`.

## 3. Custom domain

Nothing has been purchased or connected. To connect `mazleg.com` (or any domain you own):

1. **Buy the domain** at any registrar (check `mazleg.com` availability there; if taken, pick another and use it
   everywhere `mazleg.com` appears below and in `vercel.json`'s redirect rule).
2. Vercel → Project → Settings → **Domains** → add `mazleg.com`; accept adding `www.mazleg.com` and choose
   "redirect www to apex".
3. At your registrar's DNS settings, create **exactly the records Vercel shows** for your project. Vercel's
   general values are an `A` record for `@` → `76.76.21.21` and a `CNAME` for `www` → `cname.vercel-dns-0.com`,
   but projects may get specific values — use the dashboard's.
   (Alternative: switch the domain's nameservers to Vercel's and let Vercel manage DNS.)
4. Wait for verification (minutes to a few hours). Vercel issues the HTTPS certificate automatically.
5. Make sure `PUBLIC_SITE_URL`, Supabase Auth URLs and the function's `PUBLIC_SITE_URL` all say
   `https://mazleg.com`, then redeploy.
6. Check: open `https://mazleg.com`, `https://www.mazleg.com` (should redirect), and a `https://mazleg.com/join/...` link.

## 4. Test before inviting real families

```bash
npm test                 # engine + 3D logic
supabase test db         # database isolation (requires `supabase start`)
npm run test:journey     # browser journeys (real + demo) against the local stand-in (needs Python + Playwright)
```
Then repeat the journey by hand on the real site: two organizer accounts (two families), one dinner each,
open each family's link on a phone, and confirm neither organizer sees the other's data.

## Known limitations

* Live progress refreshes every 8 seconds (polling). The `preferences` table is added to Supabase Realtime for a future push-based upgrade.
* Profile photos are stored as small inline images (≤ 80 KB) in the database rather than Supabase Storage.
* If two organizers edit the same dinner at the same moment, the last save wins.
* `supabase-js` and Three.js load from version-pinned CDNs without Subresource Integrity hashes (they couldn't be
  computed offline); add SRI or vendor the files before launch.
* No per-IP rate limiting on guest functions beyond Supabase's defaults. Tokens are 192-bit, so guessing isn't practical.
