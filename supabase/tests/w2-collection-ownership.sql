-- W2 verification — a note may only reference a collection owned by the same user.
--
-- SAFE AGAINST THE LINKED PROJECT. Run it there:
--
--   npx supabase db query --linked -f supabase/tests/w2-collection-ownership.sql
--
-- What "safe" means here, precisely:
--
--   * No DDL. Nothing is created, altered or dropped at the schema level — in
--     particular `notes_collection_owner_fkey` is never touched.
--   * No existing row is modified. The checks below insert their own scratch
--     collection and notes; they never update, delete or re-share a real one, so no
--     live `share_token` is rotated and no share link a user holds is invalidated.
--   * Everything still runs inside `begin` … `rollback`, so the scratch rows are
--     discarded too — but the rollback is now the second line of defence rather than
--     the only thing standing between this file and a damaged database.
--
-- That last point is the reason for this shape. An earlier version dropped the
-- ownership foreign key and rotated a real collection's `share_token`, and relied
-- entirely on `supabase db query` honouring `begin`/`rollback` as one transaction over
-- the Management API. If that assumption ever broke — statement splitting, autocommit,
-- a dropped connection — the file would have left production with the very constraint
-- it is testing dropped, silently re-opening W2. Nothing here can do that any more.
--
-- Checks 1-3 and 5 impersonate a real signed-in caller the way PostgREST does — role
-- `authenticated`, with `request.jwt.claims.sub` set — so the policies under test are
-- the ones the app actually hits. A check that "passes" because the statement ran as
-- the table owner would prove nothing.
--
-- Check 4 is the one that cannot be fully exercised here; see its comment below, and
-- `w2-shared-collection-isolation.local.sql` for the destructive version.
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
  user_a         uuid;
  user_b         uuid;
  coll_a         uuid;
  coll_b         uuid;
  note_a         uuid;
  scratch_coll   uuid;
  scratch_token  uuid;
  scratch_note   uuid;
  hits           int;
  foreign_hits   int;
  sqlstate_seen  text;
  fn_def         text;
  failures       text[] := '{}';
  -- Checks 1-3 and 5 run as `authenticated`, which has no rights on `pg_temp`, so
  -- their results are held here and written out once the role has reset.
  results        jsonb := '[]'::jsonb;
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

  -- 2. A inserts a note pointing at B's collection. Must be refused, and refused by
  --    one of the two layers that exist for it: 42501 from the policy, 23503 from the
  --    composite key. Any other sqlstate means the statement failed for an unrelated
  --    reason and this check proved nothing.
  begin
    insert into public.notes (collection_id, title) values (coll_b, 'w2 check 2');
    failures := array_append(failures, 'check 2: INSERT into another user''s collection was ACCEPTED');
    results := results || jsonb_build_object(
      'seq', 2, 'check_id', 'A inserts note into B''s collection',
      'outcome', 'FAIL', 'detail', 'accepted — this is the W2 vulnerability');
  exception when others then
    sqlstate_seen := sqlstate;
    if sqlstate_seen not in ('42501', '23503') then
      failures := array_append(failures,
        format('check 2: refused, but with an unrelated error (%s: %s)', sqlstate_seen, sqlerrm));
      results := results || jsonb_build_object(
        'seq', 2, 'check_id', 'A inserts note into B''s collection',
        'outcome', 'FAIL', 'detail', 'unrelated error ' || sqlstate_seen);
    else
      results := results || jsonb_build_object(
        'seq', 2, 'check_id', 'A inserts note into B''s collection',
        'outcome', 'PASS', 'detail', 'refused with ' || sqlstate_seen);
    end if;
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
      if sqlstate_seen not in ('42501', '23503') then
        failures := array_append(failures,
          format('check 3: refused, but with an unrelated error (%s: %s)', sqlstate_seen, sqlerrm));
        results := results || jsonb_build_object(
          'seq', 3, 'check_id', 'A updates note into B''s collection',
          'outcome', 'FAIL', 'detail', 'unrelated error ' || sqlstate_seen);
      else
        results := results || jsonb_build_object(
          'seq', 3, 'check_id', 'A updates note into B''s collection',
          'outcome', 'PASS', 'detail', 'refused with ' || sqlstate_seen);
      end if;
    end;
  end if;

  -- 5. A share link still returns the owner's own notes, and returns nothing owned by
  --    anyone else. Run against a scratch collection this check creates and shares
  --    itself, rather than re-sharing one of A's real collections — rotating a live
  --    `share_token` would invalidate a link somebody is holding.
  begin
    insert into public.collections (name, share_token)
      values ('w2 scratch ' || gen_random_uuid()::text, gen_random_uuid())
      returning id, share_token into scratch_coll, scratch_token;

    insert into public.notes (collection_id, title, body)
      values (scratch_coll, 'w2 check 5', 'owner note')
      returning id into scratch_note;

    select count(*) into hits
      from public.shared_collection(scratch_token) where note_id = scratch_note;

    -- Nothing owned by anyone but the collection's owner may come back. With the
    -- foreign key in place a cross-owner row cannot be created to plant here, so this
    -- asserts the invariant over whatever the function actually returns.
    select count(*) into foreign_hits
      from public.shared_collection(scratch_token) s
      join public.notes n on n.id = s.note_id
     where n.user_id <> user_a;

    if hits = 1 and foreign_hits = 0 then
      results := results || jsonb_build_object(
        'seq', 5, 'check_id', 'share link returns own notes only',
        'outcome', 'PASS', 'detail', 'owner note returned, no foreign notes');
    else
      failures := array_append(failures,
        format('check 5: owner notes returned=%s, foreign notes returned=%s', hits, foreign_hits));
      results := results || jsonb_build_object(
        'seq', 5, 'check_id', 'share link returns own notes only',
        'outcome', 'FAIL', 'detail', format('own=%s foreign=%s', hits, foreign_hits));
    end if;
  exception when others then
    failures := array_append(failures, format('check 5: %s: %s', sqlstate, sqlerrm));
    results := results || jsonb_build_object(
      'seq', 5, 'check_id', 'share link returns own notes only',
      'outcome', 'FAIL', 'detail', sqlstate || ': ' || sqlerrm);
  end;

  -- --------------------------------------------------------------- back to owner
  perform set_config('role', 'none', true);

  insert into w2_results (seq, check_id, outcome, detail)
  select (e->>'seq')::int, e->>'check_id', e->>'outcome', e->>'detail'
    from jsonb_array_elements(results) e;

  -- 4. `shared_collection()` cannot surface a note owned by anyone but the collection's
  --    owner.
  --
  --    Observing that end to end needs a note whose `collection_id` points at another
  --    user's collection — and creating one means removing the composite key, which is
  --    exactly the destructive step this file no longer performs. The behavioural
  --    version lives in `w2-shared-collection-isolation.local.sql`, for a throwaway
  --    database only.
  --
  --    What is checked here instead are the two facts that make the leak impossible,
  --    both read-only:
  --
  --      a. the function's own predicate — the join carries `n.user_id = c.user_id`,
  --         so even a cross-owner row would not be returned;
  --      b. the composite key is present and validated, so no cross-owner row can be
  --         created for it to return in the first place.
  --
  --    Together with check 5's assertion over live data, a regression in either layer
  --    fails here. Losing (a) alone is not observable from outside the database while
  --    (b) holds, which is the point of having both.
  select pg_get_functiondef(p.oid) into fn_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'shared_collection';

  if fn_def is null then
    failures := array_append(failures, 'check 4a: public.shared_collection() does not exist');
    insert into w2_results values (4, 'share function carries the owner predicate', 'FAIL', 'function missing');
  elsif regexp_replace(fn_def, '\s+', ' ', 'g') ~
        '(n\.user_id = c\.user_id|c\.user_id = n\.user_id)' then
    insert into w2_results values (4, 'share function carries the owner predicate', 'PASS', 'predicate present in live definition');
  else
    failures := array_append(failures,
      'check 4a: shared_collection() no longer joins notes to collections on the same owner');
    insert into w2_results values (4, 'share function carries the owner predicate', 'FAIL', 'predicate absent');
  end if;

  select count(*) into hits
    from pg_constraint
   where conname = 'notes_collection_owner_fkey'
     and contype = 'f'
     and convalidated;

  if hits = 1 then
    insert into w2_results values (6, 'composite key present and validated', 'PASS', 'cross-owner rows cannot be created');
  else
    failures := array_append(failures,
      'check 4b: notes_collection_owner_fkey is missing or not validated');
    insert into w2_results values (6, 'composite key present and validated', 'FAIL', 'missing or NOT VALID');
  end if;

  if array_length(failures, 1) is not null then
    raise exception E'W2 verification FAILED:\n%', array_to_string(failures, E'\n');
  end if;
end $$;

select seq, check_id, outcome, detail from w2_results order by seq;

rollback;
