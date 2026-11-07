-- MAZLEG — multi-family schema with strict isolation.
-- Security model:
--   * Every row belongs to exactly one family (directly or through its event).
--   * RLS is enabled on every table. Organizers may SELECT their own family's rows. Nobody else sees anything.
--   * No client role can INSERT/UPDATE/DELETE tables directly. All writes go through SECURITY DEFINER
--     functions below, each of which authorizes the caller first.
--   * Guests (family members invited to a dinner) never get an account or workspace access. They hold an
--     invitation token (event-scoped) and, after choosing their name, a participant session secret
--     (participant-scoped). Only hashes of session secrets are stored.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- tables
create table public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  created_by  uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now()
);

create table public.family_organizers (
  family_id  uuid not null references public.families(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'organizer' check (role in ('owner', 'organizer')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index on public.family_organizers(user_id);

create table public.organizer_invites (
  code        text primary key,
  family_id   uuid not null references public.families(id) on delete cascade,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references auth.users(id) on delete set null,
  used_at     timestamptz
);

create table public.family_members (
  family_id  uuid not null references public.families(id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 40),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  age        int check (age between 0 and 130),
  photo      text check (photo is null or char_length(photo) < 80000),
  updated_at timestamptz not null default now(),
  primary key (family_id, id)
);

create table public.events (
  id           uuid primary key,
  family_id    uuid not null references public.families(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  type         text not null default 'friday' check (type in ('friday','birthday','holiday','gathering','custom')),
  custom_type  text check (custom_type is null or char_length(custom_type) <= 60),
  event_date   date,
  expected     int check (expected is null or expected between 0 and 500),
  layout_mode  text,
  layout_cfg   jsonb,
  rules        jsonb not null default '[]'::jsonb,
  voting_open  boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.events(family_id);

create table public.event_participants (
  event_id          uuid not null references public.events(id) on delete cascade,
  id                text not null check (char_length(id) between 1 and 40),
  family_member_id  text,
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  age               int check (age between 0 and 130),
  age_group         text,
  photo             text check (photo is null or char_length(photo) < 80000),
  position          int not null default 0,
  claim_hash        text unique,          -- sha256(participant session secret)
  claimed_at        timestamptz,
  primary key (event_id, id)
);

create table public.event_tables (
  event_id uuid not null references public.events(id) on delete cascade,
  id       text not null check (char_length(id) between 1 and 40),
  shape    text not null check (shape in ('rect','round','oval')),
  x real not null, y real not null, w real not null check (w > 0), h real not null check (h > 0),
  rot real not null default 0,
  primary key (event_id, id)
);

create table public.event_seats (
  event_id  uuid not null references public.events(id) on delete cascade,
  id        text not null check (char_length(id) between 1 and 40),
  table_id  text not null,
  x real not null, y real not null,
  disabled  boolean not null default false,
  position  int not null default 0,
  primary key (event_id, id),
  foreign key (event_id, table_id) references public.event_tables(event_id, id) on delete cascade
);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  token       text not null unique check (char_length(token) >= 32),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create unique index invitations_one_active on public.invitations(event_id) where revoked_at is null;

create table public.preferences (
  event_id        uuid not null,
  participant_id  text not null,
  choices         text[] not null default '{}' check (cardinality(choices) <= 2 and not (participant_id = any(choices))),
  source          text not null default 'participant' check (source in ('participant','organizer')),
  updated_at      timestamptz not null default now(),
  primary key (event_id, participant_id),               -- one active response per participant
  foreign key (event_id, participant_id) references public.event_participants(event_id, id) on delete cascade
);

create table public.seating_arrangements (
  event_id      uuid primary key references public.events(id) on delete cascade,
  meta          jsonb not null default '{}'::jsonb,     -- alternatives, locks, stats, seed
  saved_at      timestamptz,
  published_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create table public.seating_assignments (
  event_id        uuid not null references public.seating_arrangements(event_id) on delete cascade,
  participant_id  text not null,
  seat_id         text not null,
  primary key (event_id, participant_id),                -- every participant seated at most once
  unique (event_id, seat_id),                            -- never two people in one seat
  foreign key (event_id, participant_id) references public.event_participants(event_id, id) on delete cascade,
  foreign key (event_id, seat_id) references public.event_seats(event_id, id) on delete cascade
);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_family_organizer(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.family_organizers where family_id = p_family and user_id = auth.uid())
$$;

create or replace function private.assert_organizer(p_family uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_family is null or not public.is_family_organizer(p_family) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end $$;

create or replace function private.event_family_checked(p_event uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select family_id into v from public.events where id = p_event;
  perform private.assert_organizer(v);           -- unknown event → not_authorized (no existence oracle)
  return v;
end $$;

create or replace function private.new_secret()
returns text language sql volatile as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_')
$$;

create or replace function private.hash(p text)
returns text language sql immutable as $$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$$;

create or replace function private.invitation_event(p_token text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if p_token is null or char_length(p_token) not between 32 and 100 then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;
  select event_id into v from public.invitations where token = p_token and revoked_at is null;
  if v is null then raise exception 'invalid_invitation' using errcode = 'P0001'; end if;
  return v;
end $$;

create or replace function private.session_participant(p_session text, out event_id uuid, out participant_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_session is null or char_length(p_session) not between 32 and 100 then
    raise exception 'invalid_session' using errcode = 'P0001';
  end if;
  select p.event_id, p.id into event_id, participant_id from public.event_participants p where p.claim_hash = private.hash(p_session);
  if event_id is null then raise exception 'invalid_session' using errcode = 'P0001'; end if;
end $$;

-- Full event document (organizer view). Called only after authorization.
create or replace function private.event_doc(p_event uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'type', e.type, 'customType', e.custom_type, 'date', e.event_date,
    'expected', e.expected, 'layoutMode', e.layout_mode, 'cfg', e.layout_cfg, 'rules', e.rules,
    'votingOpen', e.voting_open, 'createdAt', (extract(epoch from e.created_at) * 1000)::bigint,
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'age', p.age, 'group', p.age_group,
        'photo', p.photo, 'familyId', p.family_member_id, 'claimed', p.claimed_at is not null) order by p.position)
      from public.event_participants p where p.event_id = e.id), '[]'::jsonb),
    'layout', jsonb_build_object(
      'tables', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'shape', t.shape, 'x', t.x, 'y', t.y, 'w', t.w, 'h', t.h, 'rot', t.rot))
        from public.event_tables t where t.event_id = e.id), '[]'::jsonb),
      'chairs', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'tableId', s.table_id, 'x', s.x, 'y', s.y, 'disabled', s.disabled) order by s.position)
        from public.event_seats s where s.event_id = e.id), '[]'::jsonb)),
    'votes', coalesce((select jsonb_object_agg(v.participant_id, jsonb_build_object('choices', to_jsonb(v.choices),
        'at', (extract(epoch from v.updated_at) * 1000)::bigint, 'via', v.source)) from public.preferences v where v.event_id = e.id), '{}'::jsonb),
    'plan', (select a.meta || jsonb_build_object(
        'assignment', coalesce((select jsonb_object_agg(x.participant_id, x.seat_id) from public.seating_assignments x where x.event_id = e.id), '{}'::jsonb),
        'savedAt', (extract(epoch from a.saved_at) * 1000)::bigint, 'publishedAt', (extract(epoch from a.published_at) * 1000)::bigint)
      from public.seating_arrangements a where a.event_id = e.id),
    'invite', (select jsonb_build_object('token', i.token, 'createdAt', (extract(epoch from i.created_at) * 1000)::bigint)
      from public.invitations i where i.event_id = e.id and i.revoked_at is null))
  from public.events e where e.id = p_event
$$;

-- ---------------------------------------------------------------- RLS
alter table public.families              enable row level security;
alter table public.family_organizers     enable row level security;
alter table public.organizer_invites     enable row level security;
alter table public.family_members        enable row level security;
alter table public.events                enable row level security;
alter table public.event_participants    enable row level security;
alter table public.event_tables          enable row level security;
alter table public.event_seats           enable row level security;
alter table public.invitations           enable row level security;
alter table public.preferences           enable row level security;
alter table public.seating_arrangements  enable row level security;
alter table public.seating_assignments   enable row level security;

-- Read-only policies for organizers of the owning family. No policies exist for anon → anon sees nothing.
create policy fam_read  on public.families           for select to authenticated using (public.is_family_organizer(id));
create policy org_read  on public.family_organizers  for select to authenticated using (public.is_family_organizer(family_id));
create policy oinv_read on public.organizer_invites  for select to authenticated using (public.is_family_organizer(family_id));
create policy mem_read  on public.family_members     for select to authenticated using (public.is_family_organizer(family_id));
create policy ev_read   on public.events             for select to authenticated using (public.is_family_organizer(family_id));
create policy par_read  on public.event_participants for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and public.is_family_organizer(e.family_id)));
create policy tab_read  on public.event_tables       for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and public.is_family_organizer(e.family_id)));
create policy seat_read on public.event_seats        for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and public.is_family_organizer(e.family_id)));
create policy inv_read  on public.invitations        for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and public.is_family_organizer(e.family_id)));
create policy pref_read on public.preferences        for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and public.is_family_organizer(e.family_id)));
create policy arr_read  on public.seating_arrangements for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and public.is_family_organizer(e.family_id)));
create policy asg_read  on public.seating_assignments  for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and public.is_family_organizer(e.family_id)));

-- Defense in depth: no direct writes from client roles, and anon cannot even attempt reads.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke select on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
-- Session/claim hashes are not for clients, even organizers.
revoke select on public.event_participants from authenticated;
grant select (event_id, id, family_member_id, name, age, age_group, photo, position, claimed_at) on public.event_participants to authenticated;
-- Realtime: organizers can subscribe to their own events' preferences (RLS applies).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.preferences;
  end if;
end $$;

-- ---------------------------------------------------------------- organizer API (authenticated)
create or replace function public.create_family(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if (select count(*) from public.family_organizers where user_id = auth.uid()) >= 20 then
    raise exception 'too_many_families' using errcode = 'P0001';
  end if;
  insert into public.families(name, created_by) values (btrim(p_name), auth.uid()) returning id into v;
  insert into public.family_organizers(family_id, user_id, role) values (v, auth.uid(), 'owner');
  return v;
end $$;

create or replace function public.rename_family(p_family uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_organizer(p_family);
  if coalesce(btrim(p_name), '') = '' then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  update public.families set name = btrim(p_name) where id = p_family;
end $$;

create or replace function public.my_families()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'role', o.role) order by f.created_at), '[]'::jsonb)
  from public.family_organizers o join public.families f on f.id = o.family_id where o.user_id = auth.uid()
$$;

create or replace function public.create_organizer_invite(p_family uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform private.assert_organizer(p_family);
  v := upper(encode(extensions.gen_random_bytes(8), 'hex'));
  insert into public.organizer_invites(code, family_id, created_by) values (v, p_family, auth.uid());
  return v;
end $$;

create or replace function public.accept_organizer_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.organizer_invites;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into r from public.organizer_invites where code = upper(btrim(p_code)) for update;
  if r.code is null or r.used_at is not null or r.expires_at < now() then
    raise exception 'invalid_organizer_code' using errcode = 'P0001';
  end if;
  insert into public.family_organizers(family_id, user_id, role) values (r.family_id, auth.uid(), 'organizer') on conflict do nothing;
  update public.organizer_invites set used_by = auth.uid(), used_at = now() where code = r.code;
  return r.family_id;
end $$;

create or replace function public.get_workspace(p_family uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform private.assert_organizer(p_family);
  return jsonb_build_object(
    'family', (select jsonb_build_object('id', f.id, 'name', f.name,
        'organizers', (select count(*) from public.family_organizers o where o.family_id = f.id)) from public.families f where f.id = p_family),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'age', m.age, 'photo', m.photo) order by m.name)
        from public.family_members m where m.family_id = p_family), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(private.event_doc(e.id) order by e.created_at) from public.events e where e.family_id = p_family), '[]'::jsonb));
end $$;

create or replace function public.save_event(p_family uuid, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p_event->>'id')::uuid;
  v_owner uuid;
  v_plan jsonb := p_event->'plan';
  v_bad int;
begin
  perform private.assert_organizer(p_family);
  select family_id into v_owner from public.events where id = v_id;
  if v_owner is not null and v_owner <> p_family then raise exception 'not_authorized' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_event->'participants', '[]')) > 300
     or jsonb_array_length(coalesce(p_event#>'{layout,chairs}', '[]')) > 600
     or jsonb_array_length(coalesce(p_event#>'{layout,tables}', '[]')) > 150 then
    raise exception 'too_large' using errcode = 'P0001';
  end if;

  insert into public.events as e (id, family_id, name, type, custom_type, event_date, expected, layout_mode, layout_cfg, rules, voting_open)
  values (v_id, p_family, btrim(p_event->>'name'), coalesce(p_event->>'type', 'friday'), nullif(p_event->>'customType', ''),
          nullif(p_event->>'date', '')::date, (p_event->>'expected')::int, p_event->>'layoutMode', p_event->'cfg',
          coalesce(p_event->'rules', '[]'), coalesce((p_event->>'votingOpen')::boolean, true))
  on conflict (id) do update set name = excluded.name, type = excluded.type, custom_type = excluded.custom_type,
    event_date = excluded.event_date, expected = excluded.expected, layout_mode = excluded.layout_mode,
    layout_cfg = excluded.layout_cfg, rules = excluded.rules, voting_open = excluded.voting_open, updated_at = now()
  where e.family_id = p_family;

  -- participants
  delete from public.event_participants where event_id = v_id
    and id <> all (array(select jsonb_array_elements(coalesce(p_event->'participants', '[]'))->>'id'));
  insert into public.event_participants as p (event_id, id, family_member_id, name, age, age_group, photo, position)
  select v_id, j->>'id', j->>'familyId', btrim(j->>'name'), (j->>'age')::int, j->>'group', j->>'photo', (o - 1)::int
  from jsonb_array_elements(coalesce(p_event->'participants', '[]')) with ordinality as e(j, o)
  on conflict (event_id, id) do update set family_member_id = excluded.family_member_id, name = excluded.name,
    age = excluded.age, age_group = excluded.age_group, photo = excluded.photo, position = excluded.position;
  update public.preferences pr set choices = array(select c from unnest(pr.choices) c
      where exists (select 1 from public.event_participants q where q.event_id = v_id and q.id = c))
    where pr.event_id = v_id;

  -- tables & seats (upsert + prune, so unaffected assignments survive)
  delete from public.event_tables where event_id = v_id
    and id <> all (array(select jsonb_array_elements(coalesce(p_event#>'{layout,tables}', '[]'))->>'id'));
  insert into public.event_tables as t (event_id, id, shape, x, y, w, h, rot)
  select v_id, j->>'id', j->>'shape', (j->>'x')::real, (j->>'y')::real, (j->>'w')::real, (j->>'h')::real, coalesce((j->>'rot')::real, 0)
  from jsonb_array_elements(coalesce(p_event#>'{layout,tables}', '[]')) as e(j)
  on conflict (event_id, id) do update set shape = excluded.shape, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, rot = excluded.rot;
  delete from public.event_seats where event_id = v_id
    and id <> all (array(select jsonb_array_elements(coalesce(p_event#>'{layout,chairs}', '[]'))->>'id'));
  insert into public.event_seats as s (event_id, id, table_id, x, y, disabled, position)
  select v_id, j->>'id', j->>'tableId', (j->>'x')::real, (j->>'y')::real, coalesce((j->>'disabled')::boolean, false), (o - 1)::int
  from jsonb_array_elements(coalesce(p_event#>'{layout,chairs}', '[]')) with ordinality as e(j, o)
  on conflict (event_id, id) do update set table_id = excluded.table_id, x = excluded.x, y = excluded.y, disabled = excluded.disabled, position = excluded.position;

  -- arrangement
  if v_plan is null or jsonb_typeof(v_plan) = 'null' then
    delete from public.seating_arrangements where event_id = v_id;
  else
    insert into public.seating_arrangements as a (event_id, meta, saved_at, published_at)
    values (v_id, v_plan - 'assignment' - 'savedAt' - 'publishedAt' - 'resultUrl',
            case when (v_plan->>'savedAt') is not null then now() end, null)
    on conflict (event_id) do update set meta = excluded.meta, updated_at = now(),
      saved_at = case when (v_plan->>'savedAt') is null then a.saved_at else coalesce(a.saved_at, now()) end,
      published_at = case when (v_plan->>'publishedAt') is null then null else a.published_at end;
    delete from public.seating_assignments where event_id = v_id;
    insert into public.seating_assignments(event_id, participant_id, seat_id)
    select v_id, k, v from jsonb_each_text(coalesce(v_plan->'assignment', '{}'));
    select count(*) into v_bad from public.seating_assignments a join public.event_seats s on s.event_id = a.event_id and s.id = a.seat_id
      where a.event_id = v_id and s.disabled;
    if v_bad > 0 then raise exception 'seat_unavailable' using errcode = 'P0001'; end if;
  end if;
  return private.event_doc(v_id);
end $$;

create or replace function public.delete_event(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.event_family_checked(p_event);
  delete from public.events where id = p_event;
end $$;

create or replace function public.save_family_member(p_family uuid, p_member jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_organizer(p_family);
  insert into public.family_members as m (family_id, id, name, age, photo)
  values (p_family, p_member->>'id', btrim(p_member->>'name'), (p_member->>'age')::int, p_member->>'photo')
  on conflict (family_id, id) do update set name = excluded.name, age = excluded.age, photo = excluded.photo, updated_at = now();
end $$;

create or replace function public.delete_family_member(p_family uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_organizer(p_family);
  delete from public.family_members where family_id = p_family and id = p_id;
end $$;

create or replace function public.rotate_invitation(p_event uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text := private.new_secret();
begin
  perform private.event_family_checked(p_event);
  update public.invitations set revoked_at = now() where event_id = p_event and revoked_at is null;
  insert into public.invitations(event_id, token) values (p_event, v);
  return v;
end $$;

create or replace function public.revoke_invitation(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.event_family_checked(p_event);
  update public.invitations set revoked_at = now() where event_id = p_event and revoked_at is null;
end $$;

create or replace function public.set_voting(p_event uuid, p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.event_family_checked(p_event);
  update public.events set voting_open = p_open, updated_at = now() where id = p_event;
end $$;

create or replace function public.organizer_set_preference(p_event uuid, p_participant text, p_choices text[])
returns void language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  perform private.event_family_checked(p_event);
  if not exists (select 1 from public.event_participants where event_id = p_event and id = p_participant) then
    raise exception 'unknown_participant' using errcode = 'P0001'; end if;
  v := array(select distinct c from unnest(coalesce(p_choices, '{}')) c
             where c <> p_participant and exists (select 1 from public.event_participants q where q.event_id = p_event and q.id = c));
  if cardinality(v) > 2 then raise exception 'too_many_choices' using errcode = 'P0001'; end if;
  insert into public.preferences(event_id, participant_id, choices, source) values (p_event, p_participant, v, 'organizer')
  on conflict (event_id, participant_id) do update set choices = excluded.choices, source = 'organizer', updated_at = now();
end $$;

create or replace function public.reset_participant_claim(p_event uuid, p_participant text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.event_family_checked(p_event);
  update public.event_participants set claim_hash = null, claimed_at = null where event_id = p_event and id = p_participant;
end $$;

create or replace function public.publish_arrangement(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n_people int; n_seated int;
begin
  perform private.event_family_checked(p_event);
  select count(*) into n_people from public.event_participants where event_id = p_event;
  select count(*) into n_seated from public.seating_assignments where event_id = p_event;
  if n_seated = 0 or n_seated <> n_people then raise exception 'arrangement_incomplete' using errcode = 'P0001'; end if;
  update public.seating_arrangements set published_at = now(), saved_at = coalesce(saved_at, now()) where event_id = p_event;
end $$;

-- ---------------------------------------------------------------- guest API (anon or authenticated), token-scoped
create or replace function public.join_event(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := private.invitation_event(p_token);
begin
  return (select jsonb_build_object(
    'event', jsonb_build_object('name', e.name, 'type', e.type, 'customType', e.custom_type, 'date', e.event_date, 'votingOpen', e.voting_open,
       'published', exists (select 1 from public.seating_arrangements a where a.event_id = e.id and a.published_at is not null)),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'photo', p.photo, 'claimed', p.claimed_at is not null) order by p.position)
       from public.event_participants p where p.event_id = e.id), '[]'::jsonb))
    from public.events e where e.id = v);
end $$;

create or replace function public.claim_participant(p_token text, p_participant text, p_session text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v uuid := private.invitation_event(p_token); r public.event_participants; s text;
begin
  select * into r from public.event_participants where event_id = v and id = p_participant for update;
  if r.id is null then raise exception 'unknown_participant' using errcode = 'P0001'; end if;
  if r.claim_hash is not null then
    if p_session is not null and r.claim_hash = private.hash(p_session) then return p_session; end if;
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;
  s := private.new_secret();
  update public.event_participants set claim_hash = private.hash(s), claimed_at = now() where event_id = v and id = p_participant;
  return s;
end $$;

create or replace function public.get_my_choice(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sp record;
begin
  select * into sp from private.session_participant(p_session);
  return jsonb_build_object('participantId', sp.participant_id,
    'choices', coalesce((select to_jsonb(choices) from public.preferences where event_id = sp.event_id and participant_id = sp.participant_id), '[]'::jsonb),
    'submitted', exists (select 1 from public.preferences where event_id = sp.event_id and participant_id = sp.participant_id),
    'votingOpen', (select voting_open from public.events where id = sp.event_id));
end $$;

create or replace function public.submit_preference(p_session text, p_choices text[])
returns void language plpgsql security definer set search_path = public as $$
declare sp record; v text[];
begin
  select * into sp from private.session_participant(p_session);
  if not (select voting_open from public.events where id = sp.event_id) then raise exception 'voting_closed' using errcode = 'P0001'; end if;
  v := array(select distinct c from unnest(coalesce(p_choices, '{}')) c);
  if cardinality(v) > 2 then raise exception 'too_many_choices' using errcode = 'P0001'; end if;
  if sp.participant_id = any(v) then raise exception 'cannot_choose_self' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v) c where not exists (select 1 from public.event_participants q where q.event_id = sp.event_id and q.id = c)) then
    raise exception 'unknown_participant' using errcode = 'P0001';
  end if;
  insert into public.preferences(event_id, participant_id, choices, source) values (sp.event_id, sp.participant_id, v, 'participant')
  on conflict (event_id, participant_id) do update set choices = excluded.choices, source = 'participant', updated_at = now();
end $$;

create or replace function public.get_published_seating(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := private.invitation_event(p_token);
begin
  if not exists (select 1 from public.seating_arrangements where event_id = v and published_at is not null) then
    raise exception 'not_published' using errcode = 'P0001';
  end if;
  return (select jsonb_build_object(
    'event', jsonb_build_object('name', e.name, 'date', e.event_date),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'photo', p.photo) order by p.position)
       from public.event_participants p where p.event_id = v), '[]'::jsonb),
    'layout', private.event_doc(v)->'layout',
    'assignment', coalesce((select jsonb_object_agg(x.participant_id, x.seat_id) from public.seating_assignments x where x.event_id = v), '{}'::jsonb))
    from public.events e where e.id = v);
end $$;

-- Server-only context for the AI assistant edge function (service role). Names only, never preferences of others.
create or replace function public.assistant_voter_context(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sp record;
begin
  select * into sp from private.session_participant(p_session);
  return jsonb_build_object('event', (select name from public.events where id = sp.event_id), 'me', sp.participant_id,
    'participants', (select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by position) from public.event_participants where event_id = sp.event_id));
end $$;

-- ---------------------------------------------------------------- function privileges
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.is_family_organizer(uuid) to authenticated;
grant execute on function public.create_family(text), public.rename_family(uuid, text), public.my_families(),
  public.create_organizer_invite(uuid), public.accept_organizer_invite(text), public.get_workspace(uuid),
  public.save_event(uuid, jsonb), public.delete_event(uuid), public.save_family_member(uuid, jsonb),
  public.delete_family_member(uuid, text), public.rotate_invitation(uuid), public.revoke_invitation(uuid),
  public.set_voting(uuid, boolean), public.organizer_set_preference(uuid, text, text[]),
  public.reset_participant_claim(uuid, text), public.publish_arrangement(uuid) to authenticated;
grant execute on function public.join_event(text), public.claim_participant(text, text, text), public.get_my_choice(text),
  public.submit_preference(text, text[]), public.get_published_seating(text) to anon, authenticated;
grant execute on function public.assistant_voter_context(text) to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
