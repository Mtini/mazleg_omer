"""Local stand-in for Supabase used ONLY by the browser journey test.
It mirrors the RPC contract and authorization rules of supabase/migrations/*.sql so the real UI can be
driven end-to-end. It is not the security boundary — the SQL + RLS is, and is tested by pgTAP."""
import json, os, re, secrets, hashlib, threading, time, uuid, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

DIST = sys.argv[1]; PORT = int(sys.argv[2])
L = threading.Lock()
users, tokens = {}, {}                 # email -> {id,pw}; access token -> uid
families, organizers, org_invites = {}, set(), {}
members, events = {}, {}               # (fid,id)->m ; eid -> dict
invitations = []                       # {event, token, revoked}

class Err(Exception):
    def __init__(self, msg, code='P0001'): self.msg, self.code = msg, code
H = lambda s: hashlib.sha256(s.encode()).hexdigest()
def secret(): return secrets.token_urlsafe(24)

def assert_org(uid, fid):
    if not uid: raise Err('not_authenticated', '42501')
    if not fid or (fid, uid) not in organizers: raise Err('not_authorized', '42501')
def ev_checked(uid, eid):
    e = events.get(eid); assert_org(uid, e and e['family']); return e
def inv_event(tok):
    if not tok or not (32 <= len(tok) <= 100): raise Err('invalid_invitation')
    for i in invitations:
        if i['token'] == tok and not i['revoked']: return events[i['event']]
    raise Err('invalid_invitation')
def session_part(s):
    if not s or not (32 <= len(s) <= 100): raise Err('invalid_session')
    for e in events.values():
        for p in e['participants']:
            if p.get('claim') == H(s): return e, p
    raise Err('invalid_session')
def doc(e):
    inv = next((i for i in invitations if i['event'] == e['id'] and not i['revoked']), None)
    plan = None
    if e['arr'] is not None:
        plan = dict(e['arr']['meta']); plan['assignment'] = dict(e['arr']['assign'])
        plan['savedAt'] = e['arr']['saved']; plan['publishedAt'] = e['arr']['published']
    return {'id': e['id'], 'name': e['name'], 'type': e['type'], 'customType': e['customType'], 'date': e['date'], 'expected': e['expected'],
            'layoutMode': e['layoutMode'], 'cfg': e['cfg'], 'rules': e['rules'], 'votingOpen': e['votingOpen'], 'createdAt': e['created'],
            'participants': [{k: p.get(k) for k in ('id', 'name', 'age', 'group', 'photo', 'familyId')} | {'claimed': bool(p.get('claim'))} for p in e['participants']],
            'layout': e['layout'], 'votes': {k: dict(v) for k, v in e['prefs'].items()}, 'plan': plan,
            'invite': {'token': inv['token'], 'createdAt': inv['created']} if inv else None}

def F_my_families(uid, a): return [{'id': f, 'name': families[f]['name'], 'role': 'owner' if families[f]['by'] == uid else 'organizer'} for (f, u) in organizers if u == uid]
def F_create_family(uid, a):
    if not uid: raise Err('not_authenticated', '42501')
    if not (a.get('p_name') or '').strip(): raise Err('invalid_name')
    fid = str(uuid.uuid4()); families[fid] = {'name': a['p_name'].strip(), 'by': uid}; organizers.add((fid, uid)); return fid
def F_rename_family(uid, a): assert_org(uid, a['p_family']); families[a['p_family']]['name'] = a['p_name'].strip()
def F_create_organizer_invite(uid, a):
    assert_org(uid, a['p_family']); c = secrets.token_hex(8).upper(); org_invites[c] = {'family': a['p_family'], 'used': False, 'exp': time.time() + 7 * 86400}; return c
def F_accept_organizer_invite(uid, a):
    if not uid: raise Err('not_authenticated', '42501')
    r = org_invites.get((a.get('p_code') or '').strip().upper())
    if not r or r['used'] or r['exp'] < time.time(): raise Err('invalid_organizer_code')
    organizers.add((r['family'], uid)); r['used'] = True; return r['family']
def F_get_workspace(uid, a):
    fid = a.get('p_family'); assert_org(uid, fid)
    return {'family': {'id': fid, 'name': families[fid]['name'], 'organizers': sum(1 for (f, _) in organizers if f == fid)},
            'members': sorted([dict(m) for (f, _), m in members.items() if f == fid], key=lambda m: m['name']),
            'events': [doc(e) for e in sorted(events.values(), key=lambda e: e['created']) if e['family'] == fid]}
def F_save_event(uid, a):
    fid, d = a['p_family'], a['p_event']; assert_org(uid, fid)
    eid = d['id']; old = events.get(eid)
    if old and old['family'] != fid: raise Err('not_authorized', '42501')
    if len(d.get('participants') or []) > 300: raise Err('too_large')
    pids = [p['id'] for p in d['participants']]; seats = {c['id']: c for c in d['layout']['chairs']}
    prev = {p['id']: p for p in (old['participants'] if old else [])}
    parts = [dict(p, claim=prev.get(p['id'], {}).get('claim')) for p in d['participants']]
    prefs = {k: dict(v, choices=[c for c in v['choices'] if c in pids]) for k, v in (old['prefs'] if old else {}).items() if k in pids}
    arr = old['arr'] if old else None; plan = d.get('plan')
    if plan:
        asg = plan.get('assignment') or {}
        if len(set(asg.values())) != len(asg): raise Err('duplicate key value violates unique constraint', '23505')
        for p, s in asg.items():
            if p not in pids or s not in seats: raise Err('foreign key violation', '23503')
            if seats[s].get('disabled'): raise Err('seat_unavailable')
        meta = {k: v for k, v in plan.items() if k not in ('assignment', 'savedAt', 'publishedAt', 'resultUrl')}
        arr = {'meta': meta, 'assign': asg, 'saved': (arr and arr['saved']) or (int(time.time() * 1000) if plan.get('savedAt') else None),
               'published': (arr['published'] if arr and plan.get('publishedAt') else None)}
    else: arr = None
    events[eid] = {'id': eid, 'family': fid, 'name': d['name'].strip(), 'type': d.get('type') or 'friday', 'customType': d.get('customType'), 'date': d.get('date'),
                   'expected': d.get('expected'), 'layoutMode': d.get('layoutMode'), 'cfg': d.get('cfg'), 'rules': d.get('rules') or [], 'votingOpen': d.get('votingOpen', True),
                   'created': old['created'] if old else int(time.time() * 1000), 'participants': parts, 'layout': d['layout'], 'prefs': prefs, 'arr': arr}
    return doc(events[eid])
def F_delete_event(uid, a): ev_checked(uid, a['p_event']); del events[a['p_event']]
def F_save_family_member(uid, a): assert_org(uid, a['p_family']); m = a['p_member']; members[(a['p_family'], m['id'])] = {'id': m['id'], 'name': m['name'].strip(), 'age': m.get('age'), 'photo': m.get('photo')}
def F_delete_family_member(uid, a): assert_org(uid, a['p_family']); members.pop((a['p_family'], a['p_id']), None)
def F_rotate_invitation(uid, a):
    ev_checked(uid, a['p_event'])
    for i in invitations:
        if i['event'] == a['p_event']: i['revoked'] = True
    t = secret(); invitations.append({'event': a['p_event'], 'token': t, 'revoked': False, 'created': int(time.time() * 1000)}); return t
def F_revoke_invitation(uid, a):
    ev_checked(uid, a['p_event'])
    for i in invitations:
        if i['event'] == a['p_event']: i['revoked'] = True
def F_organizer_set_preference(uid, a):
    e = ev_checked(uid, a['p_event']); ids = [p['id'] for p in e['participants']]
    if a['p_participant'] not in ids: raise Err('unknown_participant')
    v = list(dict.fromkeys(c for c in a['p_choices'] if c in ids and c != a['p_participant']))
    if len(v) > 2: raise Err('too_many_choices')
    e['prefs'][a['p_participant']] = {'choices': v, 'at': int(time.time() * 1000), 'via': 'organizer'}
def F_reset_participant_claim(uid, a):
    e = ev_checked(uid, a['p_event'])
    for p in e['participants']:
        if p['id'] == a['p_participant']: p['claim'] = None
def F_publish_arrangement(uid, a):
    e = ev_checked(uid, a['p_event'])
    if not e['arr'] or len(e['arr']['assign']) != len(e['participants']): raise Err('arrangement_incomplete')
    e['arr']['published'] = int(time.time() * 1000); e['arr']['saved'] = e['arr']['saved'] or e['arr']['published']
def F_join_event(uid, a):
    e = inv_event(a.get('p_token'))
    return {'event': {'name': e['name'], 'type': e['type'], 'customType': e['customType'], 'date': e['date'], 'votingOpen': e['votingOpen'], 'published': bool(e['arr'] and e['arr']['published'])},
            'participants': [{'id': p['id'], 'name': p['name'], 'photo': p.get('photo'), 'claimed': bool(p.get('claim'))} for p in e['participants']]}
def F_claim_participant(uid, a):
    e = inv_event(a.get('p_token')); p = next((p for p in e['participants'] if p['id'] == a.get('p_participant')), None)
    if not p: raise Err('unknown_participant')
    if p.get('claim'):
        if a.get('p_session') and p['claim'] == H(a['p_session']): return a['p_session']
        raise Err('already_claimed')
    s = secret(); p['claim'] = H(s); return s
def F_get_my_choice(uid, a):
    e, p = session_part(a.get('p_session')); v = e['prefs'].get(p['id'])
    return {'participantId': p['id'], 'choices': v['choices'] if v else [], 'submitted': bool(v), 'votingOpen': e['votingOpen']}
def F_submit_preference(uid, a):
    e, p = session_part(a.get('p_session'))
    if not e['votingOpen']: raise Err('voting_closed')
    v = list(dict.fromkeys(a.get('p_choices') or []))
    if len(v) > 2: raise Err('too_many_choices')
    if p['id'] in v: raise Err('cannot_choose_self')
    ids = [q['id'] for q in e['participants']]
    if any(c not in ids for c in v): raise Err('unknown_participant')
    e['prefs'][p['id']] = {'choices': v, 'at': int(time.time() * 1000), 'via': 'participant'}
def F_get_published_seating(uid, a):
    e = inv_event(a.get('p_token'))
    if not (e['arr'] and e['arr']['published']): raise Err('not_published')
    return {'event': {'name': e['name'], 'date': e['date']}, 'participants': [{'id': p['id'], 'name': p['name'], 'photo': p.get('photo')} for p in e['participants']],
            'layout': e['layout'], 'assignment': e['arr']['assign']}
ANON_OK = {'join_event', 'claim_participant', 'get_my_choice', 'submit_preference', 'get_published_seating'}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=DIST, **k)
    def log_message(self, *a): pass
    def send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def uid(self):
        h = self.headers.get('Authorization', ''); return tokens.get(h[7:]) if h.startswith('Bearer ') else None
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        with L:
            if self.path == '/auth/v1/signup':
                if body['email'] in users: return self.send(400, {'message': 'User already registered'})
                users[body['email']] = {'id': str(uuid.uuid4()), 'pw': body['password']}
            if self.path in ('/auth/v1/signup', '/auth/v1/token'):
                u = users.get(body.get('email'))
                if not u or u['pw'] != body.get('password'): return self.send(400, {'message': 'Invalid login credentials'})
                t = secrets.token_hex(16); tokens[t] = u['id']; return self.send(200, {'access_token': t, 'user': {'id': u['id'], 'email': body['email']}})
            m = re.match(r'^/rest/v1/rpc/(\w+)$', self.path)
            if m:
                fn = globals().get('F_' + m.group(1)); uid = self.uid()
                if not fn: return self.send(404, {'message': 'not found', 'code': 'PGRST202'})
                if not uid and m.group(1) not in ANON_OK: return self.send(401, {'message': 'permission denied for function ' + m.group(1), 'code': '42501'})
                try: return self.send(200, fn(uid, body))
                except Err as e: return self.send(400, {'message': e.msg, 'code': e.code})
            if self.path.startswith('/functions/v1/'): return self.send(503, {'error': 'ai_not_configured'})
        self.send(404, {'message': 'not found'})
    def do_GET(self):
        path = self.path.split('?')[0]
        if path.startswith('/join/') or not os.path.exists(os.path.join(DIST, path.lstrip('/'))) or path == '/':
            self.path = '/index.html'
        return super().do_GET()

ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
