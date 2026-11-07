-- Run with:  supabase test db
-- Every check runs as the real client role (anon / authenticated) with a simulated JWT, so RLS,
-- grants and SECURITY DEFINER authorization are all exercised exactly as through the API.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

-- ---------- fixtures: three users ----------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'omer@family-a.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'dana@family-b.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'cousin@family-a.test', 'authenticated', 'authenticated');

create temp table ctx (k text primary key, v text);
grant all on ctx to anon, authenticated;

-- 17-person event document with 3 connected tables (20 seats)
create temp table docs (k text primary key, j jsonb);
grant all on docs to anon, authenticated;
insert into docs values ('a_event', (
  select jsonb_build_object(
    'id', '11111111-1111-1111-1111-111111111111', 'name', 'Friday dinner A', 'type', 'friday', 'date', '2026-11-13', 'votingOpen', true,
    'participants', (select jsonb_agg(jsonb_build_object('id', 'p' || i, 'name', 'Person A' || i, 'age', 20 + i)) from generate_series(1, 17) i),
    'layout', jsonb_build_object(
      'tables', (select jsonb_agg(jsonb_build_object('id', 't' || i, 'shape', 'rect', 'x', i * 192, 'y', 0, 'w', 192, 'h', 96)) from generate_series(1, 3) i),
      'chairs', (select jsonb_agg(jsonb_build_object('id', 'c' || i, 'tableId', 't' || (1 + (i - 1) / 7), 'x', i * 30, 'y', 0)) from generate_series(1, 20) i)))));
insert into docs values ('b_event', jsonb_build_object(
    'id', '22222222-2222-2222-2222-222222222222', 'name', 'Family B dinner', 'type', 'birthday',
    'participants', (select jsonb_agg(jsonb_build_object('id', 'q' || i, 'name', 'Person B' || i)) from generate_series(1, 8) i),
    'layout', jsonb_build_object('tables', jsonb_build_array(jsonb_build_object('id', 'tb', 'shape', 'round', 'x', 0, 'y', 0, 'w', 150, 'h', 150)),
      'chairs', (select jsonb_agg(jsonb_build_object('id', 'd' || i, 'tableId', 'tb', 'x', i, 'y', 0)) from generate_series(1, 8) i))));

-- ---------- 1–3: Family A signs up, creates a 17-person dinner and an invitation ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into ctx select 'famA', public.create_family('Omer''s family')::text;
select ok((select v from ctx where k = 'famA') is not null, '1. Family A created');
select lives_ok($$ select public.save_event((select v::uuid from ctx where k = 'famA'), (select j from docs where k = 'a_event')) $$, '2. Family A saves a 17-person dinner');
select is((select count(*)::int from public.event_participants where event_id = '11111111-1111-1111-1111-111111111111'), 17, '2. organizer sees 17 participants');
insert into ctx select 'tokA', public.rotate_invitation('11111111-1111-1111-1111-111111111111');
select ok(char_length((select v from ctx where k = 'tokA')) >= 32, '3. invitation token generated (>=32 chars)');

-- ---------- 4: a guest opens the link (anon), claims a name and votes ----------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(jsonb_array_length(public.join_event((select v from ctx where k = 'tokA'))->'participants'), 17, '4. guest sees the 17-person list');
select ok(not (public.join_event((select v from ctx where k = 'tokA')) ? 'votes'), '4. join response contains no preferences');
insert into ctx select 'sess1', public.claim_participant((select v from ctx where k = 'tokA'), 'p1');
select lives_ok($$ select public.submit_preference((select v from ctx where k = 'sess1'), array['p2','p3']) $$, '4. guest submits two choices');
select lives_ok($$ select public.submit_preference((select v from ctx where k = 'sess1'), array['p4']) $$, '4. guest can change the choice (one active response)');
select throws_ok($$ select public.submit_preference((select v from ctx where k = 'sess1'), array['p2','p3','p4']) $$, 'P0001', 'too_many_choices', '4. more than two choices rejected');
select throws_ok($$ select public.submit_preference((select v from ctx where k = 'sess1'), array['p1']) $$, 'P0001', 'cannot_choose_self', '4. choosing yourself rejected');
select throws_ok($$ select public.submit_preference((select v from ctx where k = 'sess1'), array['q1']) $$, 'P0001', 'unknown_participant', '4. choosing someone from another family rejected');
select throws_ok($$ select public.claim_participant((select v from ctx where k = 'tokA'), 'p1') $$, 'P0001', 'already_claimed', '4. a second device cannot take over a claimed name');
select is(public.claim_participant((select v from ctx where k = 'tokA'), 'p1', (select v from ctx where k = 'sess1')), (select v from ctx where k = 'sess1'), '4. the same device can come back');
select throws_ok($$ select public.submit_preference('not-a-real-session-not-a-real-session', array['p2']) $$, 'P0001', 'invalid_session', '4. forged session rejected');
select throws_ok($$ select count(*) from public.preferences $$, '42501', null, '4. anon cannot read the preferences table at all');
select throws_ok($$ select count(*) from public.events $$, '42501', null, '4. anon cannot read the events table at all');

-- ---------- 5: organizer sees the vote and saves a seating arrangement ----------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select choices from public.preferences where event_id = '11111111-1111-1111-1111-111111111111' and participant_id = 'p1'), array['p4'], '5. organizer sees the latest choice');
update docs set j = j || jsonb_build_object('plan', jsonb_build_object('assignment', (select jsonb_object_agg('p' || i, 'c' || i) from generate_series(1, 17) i), 'seed', 1))
  where k = 'a_event';
select lives_ok($$ select public.save_event((select v::uuid from ctx where k = 'famA'), (select j from docs where k = 'a_event')) $$, '5. seating arrangement saved');
select is((select count(*)::int from public.seating_assignments where event_id = '11111111-1111-1111-1111-111111111111'), 17, '5. 17 people seated');
select throws_ok($$ select public.save_event((select v::uuid from ctx where k = 'famA'),
    (select j from docs where k = 'a_event') || '{"plan":{"assignment":{"p1":"c1","p2":"c1"}}}'::jsonb) $$, '23505', null, '5. database refuses two people in one seat');
select is((select votes from (select (public.get_workspace((select v::uuid from ctx where k = 'famA'))->'events'->0->'votes'->'p1'->'choices') votes) x), '["p4"]'::jsonb, '5. failed save rolled back cleanly; vote intact');

-- ---------- 6–7: Family B, completely independent ----------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
insert into ctx select 'famB', public.create_family('Dana''s family')::text;
select lives_ok($$ select public.save_event((select v::uuid from ctx where k = 'famB'), (select j from docs where k = 'b_event')) $$, '7. Family B saves its own 8-person dinner');
insert into ctx select 'tokB', public.rotate_invitation('22222222-2222-2222-2222-222222222222');

-- ---------- 8: Family B cannot reach Family A ----------
select is((select count(*)::int from public.families), 1, '8. B sees only its own family');
select is((select count(*)::int from public.events), 1, '8. B sees only its own events');
select is((select count(*)::int from public.event_participants where event_id = '11111111-1111-1111-1111-111111111111'), 0, '8. B cannot read A participants by event id');
select is((select count(*)::int from public.preferences where event_id = '11111111-1111-1111-1111-111111111111'), 0, '8. B cannot read A preferences');
select is((select count(*)::int from public.invitations where event_id = '11111111-1111-1111-1111-111111111111'), 0, '8. B cannot read A invitation tokens');
select throws_ok($$ select public.get_workspace((select v::uuid from ctx where k = 'famA')) $$, '42501', 'not_authorized', '8. B cannot open A workspace by family id');
select throws_ok($$ select public.save_event((select v::uuid from ctx where k = 'famA'), (select j from docs where k = 'b_event')) $$, '42501', 'not_authorized', '8. B cannot write into A family');
select throws_ok($$ select public.save_event((select v::uuid from ctx where k = 'famB'), (select j from docs where k = 'a_event')) $$, '42501', 'not_authorized', '8. B cannot hijack A event id into its own family');
select throws_ok($$ select public.rotate_invitation('11111111-1111-1111-1111-111111111111') $$, '42501', 'not_authorized', '8. B cannot create invitations for A');
select throws_ok($$ select public.delete_event('11111111-1111-1111-1111-111111111111') $$, '42501', 'not_authorized', '8. B cannot delete A dinner');
select throws_ok($$ select public.organizer_set_preference('11111111-1111-1111-1111-111111111111', 'p1', array['p2']) $$, '42501', 'not_authorized', '8. B cannot alter A votes');
select throws_ok($$ insert into public.events(id, family_id, name) values (gen_random_uuid(), (select v::uuid from ctx where k = 'famA'), 'x') $$, '42501', null, '8. direct table writes are refused');

-- ---------- 9: Family A cannot reach Family B ----------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.events where family_id = (select v::uuid from ctx where k = 'famB')), 0, '9. A cannot read B events');
select throws_ok($$ select public.get_workspace((select v::uuid from ctx where k = 'famB')) $$, '42501', 'not_authorized', '9. A cannot open B workspace');
select throws_ok($$ select public.publish_arrangement('22222222-2222-2222-2222-222222222222') $$, '42501', 'not_authorized', '9. A cannot publish for B');

-- ---------- 10: invalid / revoked / cross-event tokens ----------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.join_event('this-token-does-not-exist-0000000000') $$, 'P0001', 'invalid_invitation', '10. unknown token rejected');
select throws_ok($$ select public.join_event('short') $$, 'P0001', 'invalid_invitation', '10. malformed token rejected');
select throws_ok($$ select public.claim_participant((select v from ctx where k = 'tokB'), 'p1') $$, 'P0001', 'unknown_participant', '10. B token cannot claim an A participant');
select throws_ok($$ select public.get_published_seating((select v from ctx where k = 'tokA')) $$, 'P0001', 'not_published', '10. unpublished seating stays private');
select throws_ok($$ select public.get_workspace((select v::uuid from ctx where k = 'famA')) $$, '42501', null, '10. a guest has no workspace access');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into ctx select 'tokA2', public.rotate_invitation('11111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.publish_arrangement('11111111-1111-1111-1111-111111111111') $$, '10. A publishes the arrangement');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.join_event((select v from ctx where k = 'tokA')) $$, 'P0001', 'invalid_invitation', '10. revoked (rotated) link rejected');
select is(jsonb_array_length(public.join_event((select v from ctx where k = 'tokA2'))->'participants'), 17, '10. new link works');
select is((select count(*)::int from jsonb_object_keys(public.get_published_seating((select v from ctx where k = 'tokA2'))->'assignment')), 17, '10. published seating visible with the link');

-- ---------- organizer roles: a second organizer joins A by code; guests never get workspace ----------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into ctx select 'code', public.create_organizer_invite((select v::uuid from ctx where k = 'famA'));
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ select public.get_workspace((select v::uuid from ctx where k = 'famA')) $$, '42501', 'not_authorized', 'cousin has no access before accepting');
select is(public.accept_organizer_invite((select v from ctx where k = 'code'))::text, (select v from ctx where k = 'famA'), 'cousin joins Family A as organizer');
select is(jsonb_array_length(public.get_workspace((select v::uuid from ctx where k = 'famA'))->'events'), 1, 'cousin now sees Family A dinner');
select is((select count(*)::int from public.events where family_id = (select v::uuid from ctx where k = 'famB')), 0, 'cousin still cannot see Family B');

reset role;
select * from finish();
rollback;
