-- W2 verification — a note may only reference a collection owned by the same user.
--
-- Run against the linked project:
--   npx supabase db query --linked -f supabase/tests/w2-collection-ownership.sql
--
-- Everything happens inside a transaction that ends in `rollback`, so the database is
-- unchanged whether the checks pass or fail. It uses two accounts that already exist
-- rather than inventing users, because `notes.user_id` and `collections.user_id` both
-- reference `auth.users`.
--
-- Checks 1-3 impersonate a real signed-in caller the way PostgREST does — role
-- `authenticated`, with `request.jwt.claims.sub` set — so the policies under test are
-- the ones the app actually hits. A check that "passes" because the statement ran as
-- the table owner would prove nothing.
--
-- Any failure raises, which aborts and rolls back. Success returns one row per check.

begin;

create temporary table w2_results (
  seq      int,
  check_id text,
  outcome  text,
  detail   text
) on commit drop;

do $$
declare
  user_a        uuid;
  user_b        uuid;
  coll_a        uuid;
  coll_b        uuid;
  note_a        uuid;
  foreign_id    uuid;
  share         uuid;
  hits          int;
  sqlstate_seen text;
  failures      text[] := '{}';
  -- Checks 1-3 run as `authenticated`, which has no rights on `pg_temp`, so their
  -- results are held here and written out once the role has reset.
  results       jsonb := '[]'::jsonb;
begin
  -- Two distinct owners, each with a collection of their own.
  select user_id into user_a
    from public.collections group by user_id order by user_id limit 1;
  select user_id into user_b
    from public.collections where user_id <> user_a
    group by user_id order by user_id limit 1;

  if user_a is null or user_b is null then
    raise exception 'W2 verification needs two accounts that each own a collection';
  end if;

  select id into coll_a from public.collections where user_id = user_a order by id limit 1;
  select id into coll_b from public.collections where user_id = user_b order by id limit 1;

  -- ---------------------------------------------------------------- become user A
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);

  -- 1. A attaches their own note to their own collection. Must succeed — this is the
  --    behaviour the fix must not break.
  begin
    insert into public.notes (collection_id, title)
      values (coll_a, 'w2 check 1') returning id into note_a;
    results := results || jsonb_build_object(
      'seq', 1, 'check_id', 'A attaches note to own collection',
      'outcome', 'PASS', 'detail', 'accepted');
  exception when others then
    failures := array_append(failures, format('check 1: own collection refused (%s: %s)', sqlstate, sqlerrm));
    results := results || jsonb_build_object(
      'seq', 1, 'check_id', 'A attaches note to own collection',
      'outcome', 'FAIL', 'detail', sqlstate || ': ' || sqlerrm);
  end;

  -- 2. A inserts a note pointing at B's collection. Must be refused.
  begin
    insert into public.notes (collection_id, title) values (coll_b, 'w2 check 2');
    failures := array_append(failures, 'check 2: INSERT into another user''s collection was ACCEPTED');
    results := results || jsonb_build_object(
      'seq', 2, 'check_id', 'A inserts note into B''s collection',
      'outcome', 'FAIL', 'detail', 'accepted — this is the W2 vulnerability');
  exception when others then
    sqlstate_seen := sqlstate;
    results := results || jsonb_build_object(
      'seq', 2, 'check_id', 'A inserts note into B''s collection',
      'outcome', 'PASS', 'detail', 'refused with ' || sqlstate_seen);
  end;

  -- 3. A moves an existing note of theirs into B's collection. Must be refused.
  --    Separate from check 2: INSERT and UPDATE are separate policies.
  if note_a is null then
    failures := array_append(failures, 'check 3: skipped, check 1 produced no note');
    results := results || jsonb_build_object(
      'seq', 3, 'check_id', 'A updates note into B''s collection',
      'outcome', 'FAIL', 'detail', 'skipped');
  else
    begin
      update public.notes set collection_id = coll_b where id = note_a;
      failures := array_append(failures, 'check 3: UPDATE into another user''s collection was ACCEPTED');
      results := results || jsonb_build_object(
        'seq', 3, 'check_id', 'A updates note into B''s collection',
        'outcome', 'FAIL', 'detail', 'accepted — this is the W2 vulnerability');
    exception when others then
      sqlstate_seen := sqlstate;
      results := results || jsonb_build_object(
        'seq', 3, 'check_id', 'A updates note into B''s collection',
        'outcome', 'PASS', 'detail', 'refused with ' || sqlstate_seen);
    end;
  end if;

  -- --------------------------------------------------------------- back to owner
  perform set_config('role', 'none', true);

  insert into w2_results (seq, check_id, outcome, detail)
  select (e->>'seq')::int, e->>'check_id', e->>'outcome', e->>'detail'
    from jsonb_array_elements(results) e;

  -- 4. A shared collection must not surface a note owned by anyone else.
  --
  --    This exercises `public.shared_collection()` on its own, so the row it needs is
  --    planted with the composite key temporarily dropped — otherwise the key stops
  --    the setup and the function's own predicate is never tested. Both the drop and
  --    the row disappear with the rollback.
  alter table public.notes drop constraint if exists notes_collection_owner_fkey;

  insert into public.notes (user_id, collection_id, title, body)
    values (user_b, coll_a, 'w2 check 4 — planted', 'must never be shared')
    returning id into foreign_id;

  update public.collections set share_token = gen_random_uuid() where id = coll_a
    returning share_token into share;

  select count(*) into hits
    from public.shared_collection(share) where note_id = foreign_id;

  if hits > 0 then
    failures := array_append(failures, 'check 4: a note owned by another user appeared on the share page');
    insert into w2_results values
      (4, 'share link hides foreign notes', 'FAIL', 'planted note was returned');
  else
    insert into w2_results values
      (4, 'share link hides foreign notes', 'PASS', 'planted note absent');
  end if;

  -- 5. The owner's own note is still there: the join predicate must not have emptied
  --    the share page.
  if note_a is not null then
    select count(*) into hits
      from public.shared_collection(share) where note_id = note_a;

    if hits = 1 then
      insert into w2_results values
        (5, 'share link keeps own notes', 'PASS', 'owner note still returned');
    else
      failures := array_append(failures, 'check 5: the owner''s own note vanished from the share page');
      insert into w2_results values
        (5, 'share link keeps own notes', 'FAIL', 'owner note missing');
    end if;
  end if;

  if array_length(failures, 1) is not null then
    raise exception E'W2 verification FAILED:\n%', array_to_string(failures, E'\n');
  end if;
end $$;

select seq, check_id, outcome, detail from w2_results order by seq;

rollback;
