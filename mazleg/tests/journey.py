"""The 12-step multi-family journey, driven through the real production UI in Chromium."""
import asyncio, json, re, subprocess, sys, time
from playwright.async_api import async_playwright
BASE = 'http://127.0.0.1:8787'
STANDIN = open('tests/standin_supabase.js').read(); MOCK3 = open('/home/claude/mz/mock_three.js').read()
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)) if info else ''))
async def route(r):
    u = r.request.url
    if u.startswith(BASE): return await r.continue_()
    if 'supabase-js' in u: return await r.fulfill(body=STANDIN, content_type='text/javascript')
    if 'three.min.js' in u: return await r.fulfill(body=MOCK3, content_type='text/javascript')
    if 'OrbitControls' in u: return await r.fulfill(body='', content_type='text/javascript')
    return await r.abort()
async def ctx(b, mobile=False):
    c = await b.new_context(**({'viewport': {'width': 390, 'height': 844}, 'is_mobile': True, 'has_touch': True} if mobile else {'viewport': {'width': 1280, 'height': 900}}))
    await c.route('**/*', route); p = await c.new_page(); p.errs = []
    p.on('pageerror', lambda e: p.errs.append(str(e))); return c, p
async def toast(p):
    try: return await p.locator('#toast').inner_text(timeout=3000)
    except Exception: return ''
async def signup_family(p, email, fam):
    await p.goto(BASE + '/'); await p.wait_for_selector('[data-act="authStart"][data-mode="signup"]')
    await p.click('[data-act="authStart"][data-mode="signup"]')
    await p.fill('#au-email', email); await p.fill('#au-pass', 'correct-horse-9'); await p.click('[data-act="authSubmit"]')
    await p.wait_for_selector('#fam-name'); await p.fill('#fam-name', fam); await p.click('[data-act="famCreate"]')
    await p.wait_for_selector('.fam-bar')
async def create_dinner(p, name, people):
    await p.click('[data-act="newDinner"]'); await p.fill('#ev-name', name); await p.click('[data-act="wzNext"]')
    await p.click('[data-act="modal"][data-kind="paste"]'); await p.fill('#paste-ta', '\n'.join(people)); await p.click('[data-act="pasteAdd"]')
    await p.click('[data-act="wzNext"]'); await p.click('[data-act="wzNext"]'); await p.click('[data-act="wzFinish"]')
    await p.wait_for_selector('.linkbox input[value*="/join/"]', timeout=8000)
    return await p.input_value('.linkbox input')
async def vote(b, link, who, picks, mobile=True):
    c, p = await ctx(b, mobile); await p.goto(link); await p.wait_for_selector('[data-act="voteMe"]')
    await p.locator(f'[data-act="voteMe"]:has-text("{who}")').click(); await p.click('[data-act="confirmOk"]')
    await p.wait_for_selector('[data-act="votePick"]')
    for x in picks: await p.locator(f'.name-card[data-act="votePick"]:has-text("{x}")').click()
    await p.click('[data-act="voteSubmit"]'); await p.click('[data-act="confirmOk"]')
    await p.wait_for_selector('text=' + ('הבחירה נשלחה למארגן'), timeout=5000)
    return c, p

async def main():
    srv = subprocess.Popen([sys.executable, 'tests/standin_server.py', 'dist', '8787']); time.sleep(0.8)
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch(args=['--no-sandbox'])
            A = ['סבתא רחל', 'סבא משה', 'דני', 'מיכל', 'נועם', 'אופיר', 'יעל', 'איתי', 'שירה', 'עומר', 'תמר', 'אורי', 'מאיה', 'רון', 'דנה', 'גיל', 'ליה']
            # 1-3 Family A
            ca, pa = await ctx(b)
            await pa.goto(BASE + '/'); check('first visit shows a clean welcome screen, no sample data', await pa.locator('[data-act="authStart"]').count() and await pa.locator('.evrow').count() == 0)
            await signup_family(pa, 'omer@a.test', 'משפחת עומר'); check('1. Family A account + family workspace created', await pa.locator('.fam-bar:has-text("משפחת עומר")').count())
            linkA = await create_dinner(pa, 'ארוחת שישי', A)
            check('2. Family A dinner with 17 participants', '17' in await pa.inner_text('.big-n'))
            check('3. invitation link generated on the real domain path', re.match(BASE + r'/join/[A-Za-z0-9_-]{32,}$', linkA), linkA)
            # 4 participants vote on phones
            cp1, pp1 = await vote(b, linkA, 'נועם', ['אופיר', 'יעל'])
            check('4. participant opened link on a phone and voted', True)
            check('4. guests see no organizer navigation', await pp1.locator('.navbtn').count() == 0)
            await vote(b, linkA, 'אופיר', ['נועם']); await vote(b, linkA, 'סבתא רחל', ['סבא משה', 'דני']); await vote(b, linkA, 'סבא משה', ['סבתא רחל'])
            c2, p2 = await ctx(b, True); await p2.goto(linkA); await p2.wait_for_selector('[data-act="voteMe"]')
            await p2.locator('[data-act="voteMe"]:has-text("נועם")').click(); await p2.click('[data-act="confirmOk"]')
            check('4. same name cannot be claimed from a second phone', 'כבר נבחר' in await toast(p2))
            await pp1.reload(); await pp1.wait_for_selector('text=הבחירה נשלחה למארגן')
            check('4. returning on the same phone shows the saved choice', True)
            # 5 organizer sees votes, generates, publishes
            await pa.reload(); await pa.wait_for_selector('.fam-bar'); await pa.click('.evrow'); await pa.wait_for_selector('.big-n')
            check('5. organizer sees 4 votes from the server', (await pa.inner_text('.big-n')).startswith('4'), await pa.inner_text('.big-n'))
            await pa.click('[data-act="toggleVoting"]'); await pa.click('[data-act="generate"]'); await pa.wait_for_selector('#seatplan', timeout=15000)
            await pa.wait_for_timeout(3300)
            check('5. seating generated', await pa.locator('#seatplan [data-chair]').count() == 20)
            await pa.click('[data-act="publish"]'); await pa.wait_for_selector('.present-card', timeout=12000)
            check('5. arrangement published (presentation shown)', True)
            await pa.click('[data-act="presentClose"]')
            c3, p3 = await ctx(b, True); await p3.goto(linkA); await p3.wait_for_selector('#findme', timeout=8000)
            try: await p3.wait_for_function("document.querySelectorAll('.v3d-labels .lbl').length === 17", timeout=8000); n = 17
            except Exception: n = await p3.locator('.v3d-labels .lbl').count()
            check('5. family member sees the published seating via the link (17 names)', n == 17, n)
            await p3.select_option('#findme', index=5); await p3.wait_for_timeout(300)
            check('5. guest finds their seat with left/right neighbours', 'משמאל' in await p3.inner_text('.narrow .card'))
            famA = await pa.evaluate('S.family.id'); evA = await pa.evaluate('S.store.events[0].id')
            # 6-7 Family B
            cb, pb = await ctx(b)
            await signup_family(pb, 'dana@b.test', 'משפחת דנה')
            check('6. Family B created independently; sees no Family A data', await pb.locator('.evrow').count() == 0 and 'ארוחת שישי' not in await pb.inner_text('#main'))
            linkB = await create_dinner(pb, 'יום הולדת', ['B' + str(i) for i in range(1, 9)])
            check('7. Family B dinner with 8 participants', '8' in await pb.inner_text('.big-n'))
            famB = await pb.evaluate('S.family.id'); evB = await pb.evaluate('S.store.events[0].id')
            # 8-9 cross-family tampering through the API with real session tokens
            async def attempt(p, fn, args):
                return await p.evaluate("async ([f,a]) => { const r = await sb.rpc(f,a); return r.error ? r.error.message : 'ALLOWED' }", [fn, args])
            r = await attempt(pb, 'get_workspace', {'p_family': famA}); check('8. B cannot open A workspace by changing the family id', r == 'not_authorized', r)
            r = await attempt(pb, 'save_event', {'p_family': famB, 'p_event': {'id': evA, 'name': 'x', 'participants': [], 'layout': {'tables': [], 'chairs': []}}}); check('8. B cannot hijack A event id', r == 'not_authorized', r)
            r = await attempt(pb, 'rotate_invitation', {'p_event': evA}); check('8. B cannot create links for A', r == 'not_authorized', r)
            r = await attempt(pb, 'delete_event', {'p_event': evA}); check('8. B cannot delete A dinner', r == 'not_authorized', r)
            r = await attempt(pa, 'get_workspace', {'p_family': famB}); check('9. A cannot open B workspace', r == 'not_authorized', r)
            r = await attempt(pa, 'publish_arrangement', {'p_event': evB}); check('9. A cannot act on B dinner', r == 'not_authorized', r)
            r = await attempt(p3, 'get_workspace', {'p_family': famA}); check('guest with a link has no workspace access', r != 'ALLOWED', r)
            await pa.reload(); await pa.wait_for_selector('.fam-bar'); check('A dinner still intact after attacks', await pa.locator('.evrow').count() == 1)
            # 10 revoked + invalid links
            await pa.click('.evrow'); await pa.wait_for_selector('[data-act="inviteRotate"]'); await pa.click('[data-act="inviteRotate"]'); await pa.click('[data-act="confirmOk"]')
            await pa.wait_for_timeout(600); newA = await pa.input_value('.linkbox input')
            c4, p4 = await ctx(b, True); await p4.goto(linkA); await p4.wait_for_timeout(800)
            check('10. old (rotated) link rejected', await p4.locator('text=הקישור לא פעיל').count() > 0)
            await p4.goto(BASE + '/join/' + 'x' * 40); await p4.wait_for_timeout(800)
            check('10. made-up link rejected', await p4.locator('text=הקישור לא פעיל').count() > 0)
            await p4.goto(newA); await p4.wait_for_timeout(1000)
            check('10. new link works', await p4.locator('#findme').count() > 0, newA)
            await pa.click('[data-act="inviteRevoke"]'); await pa.click('[data-act="confirmOk"]'); await pa.wait_for_timeout(500)
            await p4.goto(newA); await p4.wait_for_timeout(800)
            check('10. revoked link rejected', await p4.locator('text=הקישור לא פעיל').count() > 0)
            # 11 mobile layout sanity
            await p3.screenshot(path='tests/shot-mobile-result.png'); await pp1.screenshot(path='tests/shot-mobile-done.png')
            w = await p3.evaluate('document.documentElement.scrollWidth'); check('11. no horizontal overflow on a 390px phone', w <= 392, w)
            # 12 PWA installability (Chromium's own check)
            cdp = await pa.context.new_cdp_session(pa)
            await pa.goto(BASE + '/'); await pa.wait_for_timeout(1500)
            sw = await pa.evaluate("navigator.serviceWorker.getRegistration().then(r => !!(r && (r.active || r.installing || r.waiting)))")
            check('12. service worker registered', sw)
            man = await cdp.send('Page.getAppManifest'); check('12. manifest parsed without errors', not man.get('errors'), man.get('errors'))
            inst = await cdp.send('Page.getInstallabilityErrors'); check('12. Chromium reports MAZLEG installable', not inst['installabilityErrors'], inst['installabilityErrors'])
            errs = [e for p in (pa, pb, pp1, p3, p4) for e in p.errs]; check('no JavaScript errors in any browser', not errs, errs[:3])
            await b.close()
    finally:
        srv.terminate()
    print(f"\n{sum(ok for _, ok in results)}/{len(results)} checks passed")
asyncio.run(main())
