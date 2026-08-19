-- ############################################################################
-- ## LOCAL / THROWAWAY DATABASES ONLY. NEVER RUN THIS AGAINST --linked.      ##
-- ############################################################################
--
-- This file DROPS `notes_collection_owner_fkey` — the composite key that is one of the
-- three layers protecting W2 — in order to create a row that the key exists to prevent.
-- It is wrapped in `begin` … `rollback`, but do not rely on that: if the transaction is
-- not honoured end to end, the database is left with the constraint gone and a
-- cross-owner note present. On the production project that silently re-opens W2.
--
-- Run it only where losing the database costs nothing:
--
--   npx supabase db query --local   -f supabase/tests/w2-shared-collection-isolation.local.sql
--   npx supabase db query --db-url <throwaway-branch-url> -f supabase/tests/…
--
-- The safe, production-linked verification is `w2-collection-ownership.sql`. That file
-- covers checks 1, 2, 3 and 5 behaviourally and asserts this function's predicate
-- statically. This file is the behavioural version of that one assertion, and the only
-- reason it exists is that layer 3 is unobservable from outside the database while
-- layer 1 holds — a cross-owner row simply cannot be created.
--
-- What it proves: `public.shared_collection()` filters on the owner itself, not merely
-- on `collection_id`. So a cross-owner row that predates the composite key, or one that
-- some future path creates, still cannot surface on a stranger's share page.

begin;

do $$
declare
  user_a      uuid;
  user_b      uuid;
  coll_a      uuid;
  own_note    uuid;
  foreign_id  uuid;
  share       uuid;
  hits        int;
  own_hits    int;
begin
  select user_id into user_a
    from public.collections group by user_id order by user_id limit 1;
  select user_id into user_b
    from public.collections where user_id <> user_a
    group by user_id order by user_id limit 1;

  if user_a is null or user_b is null then
    raise exception 'needs two accounts that each own a collection';
  end if;

  -- A scratch collection of A's, shared. Created rather than borrowed, so even here no
  -- existing collection's share_token is rotated.
  insert into public.collections (user_id, name, share_token)
    values (user_a, 'w2 isolation ' || gen_random_uuid()::text, gen_random_uuid())
    returning id, share_token into coll_a, share;

  insert into public.notes (user_id, collection_id, title, body)
    values (user_a, coll_a, 'owner note', 'should be shared')
    returning id into own_note;

  -- The destructive step, and the whole reason this file is quarantined: without it the
  -- composite key refuses the planted row and the function's predicate is never tested.
  alter table public.notes drop constraint if exists notes_collection_owner_fkey;

  insert into public.notes (user_id, collection_id, title, body)
    values (user_b, coll_a, 'planted', 'must never be shared')
    returning id into foreign_id;

  select count(*) into hits
    from public.shared_collection(share) where note_id = foreign_id;

  select count(*) into own_hits
    from public.shared_collection(share) where note_id = own_note;

  if hits > 0 then
    raise exception 'FAIL: a note owned by another user appeared on the share page';
  end if;

  if own_hits <> 1 then
    raise exception 'FAIL: the owner''s own note vanished from the share page (got %)', own_hits;
  end if;

  raise notice 'PASS: planted cross-owner note absent, owner note still returned';
end $$;

select 'PASS — shared_collection() filters on owner, not just collection_id' as result;

rollback;
