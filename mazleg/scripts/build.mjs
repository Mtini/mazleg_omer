// Production build: no dependencies. Produces dist/ for any static host.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');
const env = (k, d = '') => (process.env[k] ?? d).trim();
if (existsSync(join(root, '.env'))) for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const site = env('PUBLIC_SITE_URL');
const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PUBLIC_SITE_URL'].filter((k) => !env(k));
if (missing.length && process.env.ALLOW_INCOMPLETE !== '1') { console.error('Missing env: ' + missing.join(', ')); process.exit(1); }
if (/claude\.ai|vercel\.app|netlify\.app|localhost/.test(site) && process.env.ALLOW_DEV_URL !== '1') {
  console.error(`PUBLIC_SITE_URL=${site} is a development/preview address. Use your own domain (or set ALLOW_DEV_URL=1 for testing).`); process.exit(1);
}
const out = join(root, 'dist'); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
cpSync(join(root, 'public'), out, { recursive: true });
const logo = readFileSync(join(root, 'public/images/mazleg-logo.png')).toString('base64');
const icon = readFileSync(join(root, 'public/favicon.png')).toString('base64');
const app = ['i18n.js', 'app1.js', 'app2.js', 'app3.js', 'app4.js', 'app5.js', 'app6.js', 'app7.js', 'app8-server.js', 'app9-demo.js', 'boot.js'].map(src).join('\n').replace("'__BASE_URL__'", "''");
const buildId = createHash('sha256').update(app + src('styles.css') + src('engine.js') + src('scene3d.js')).digest('hex').slice(0, 12);
const splash = [[1290, 2796, 430, 932, 3], [1179, 2556, 393, 852, 3], [1170, 2532, 390, 844, 3], [1125, 2436, 375, 812, 3], [828, 1792, 414, 896, 2], [750, 1334, 375, 667, 2]]
  .map(([w, h, dw, dh, r]) => `<link rel="apple-touch-startup-image" href="/icons/splash-${w}x${h}.png" media="(device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)">`).join('\n');
const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>MAZLEG · מזלג</title>
<meta name="description" content="Every seat has a story. Family seating, arranged with care.">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141312" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="MAZLEG">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
${splash}
<meta property="og:title" content="MAZLEG · מזלג"><meta property="og:description" content="Every seat has a story."><meta property="og:image" content="${site}/icons/icon-512.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=IBM+Plex+Sans+Hebrew:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${src('styles.css')}
</style>
</head>
<body>
<div id="app"></div>
<input type="file" id="file" accept="image/*" hidden>
<script src="/config.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
<script>
${src('engine.js')}
${src('scene3d.js')}
</script>
<script>
const LOGO = '/images/mazleg-logo.png';
${app}
</script>
</body>
</html>`;
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'config.js'), `window.MAZLEG_CONFIG = ${JSON.stringify({ supabaseUrl: env('SUPABASE_URL'), supabaseAnonKey: env('SUPABASE_ANON_KEY'), siteUrl: site, ai: env('MAZLEG_AI', 'true') !== 'false' })};\n`);
writeFileSync(join(out, 'sw.js'), readFileSync(join(out, 'sw.js'), 'utf8').replace('__BUILD_ID__', buildId));
if (/service_role|sk-ant-/.test(readFileSync(join(out, 'config.js'), 'utf8') + html)) { console.error('Refusing to build: a secret key appears in frontend output.'); process.exit(1); }
console.log(`Built dist/ (build ${buildId}) for ${site || '(no site URL)'}`);
