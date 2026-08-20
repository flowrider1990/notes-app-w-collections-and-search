-- Constrain note_images.storage_path to the owner's own prefix.
--
-- `note_images_insert` (added in 20260817145538) already checked that the row's
-- user_id is the caller and that the parent note belongs to them, but it said
-- nothing about storage_path. The column is free text, so a caller reaching
-- PostgREST directly could record a row pointing at another user's prefix —
-- `{someone else}/{note}/{uuid}.png`. Nothing would ever render from it:
-- `createSignedUrls` is evaluated under the caller's own storage.objects SELECT
-- policy, so signing a foreign prefix fails and `getNoteImages` drops the entry.
-- But that put the entire defence in Storage while the row itself was accepted.
-- This moves the check to where the row is written, which is what the other five
-- tables already do for their own ownership claims.
--
-- `storage.foldername` rather than `split_part`, deliberately: the three
-- storage.objects policies in 20260817145538 pin
-- `(storage.foldername(name))[1] = auth.uid()::text`, and reusing the same
-- function keeps this table's idea of "the first segment" identical to theirs,
-- instead of a second implementation that can drift from it. It is also the
-- stricter of the two here — `storage.foldername` returns an empty array for a
-- path with no slash, so `[1]` is NULL and the row is refused, where `split_part`
-- would return the whole string and accept a bare `{uid}` with no file in it. RLS
-- `WITH CHECK` treats NULL as "not true", which is what makes that work.
--
-- This pins the first segment; it is not a path canonicaliser. `{uid}/../x/y.png`
-- has `{uid}` as its first segment and is accepted, as is a trailing-slash path
-- with no filename. Neither is exploitable — signing and removal both look up
-- storage.objects by the literal name, no object exists under either string, so
-- `getNoteImages` drops the row — but do not read this conjunct as more than it is.
--
-- INSERT only, which is sufficient *while* note_images has no UPDATE policy: a
-- storage_path cannot be rewritten today, and the SELECT and DELETE policies are
-- already user_id-scoped, so neither can produce a mismatched row. That is a
-- standing condition, not a fact. `authenticated` still holds the UPDATE grant on
-- this table (only TRUNCATE was revoked, see docs/schema.sql section 8), so adding
-- a conventional `note_images_update` policy would silently reopen this hole:
-- insert a conforming row, then PATCH storage_path to a foreign prefix. Do not add
-- one without carrying this conjunct into its WITH CHECK, or without replacing both
-- with a table CHECK against the row's own user_id, which would hold for every role
-- and every command the way 20260819133628 did for notes.collection_id.
--
-- Existing rows are untouched — a WITH CHECK applies to new rows only. Every path
-- the app has ever written comes from `addNoteImage` in lib/db/index.ts as
-- `${requireUser().id}/${noteId}/${uuid}.${ext}`, so no valid attachment changes
-- behaviour.

-- Pre-flight, and the one check here that can actually fail: the policy below is
-- useless if `authenticated` cannot call the function it depends on — every insert
-- would be refused rather than only the bad ones. The storage.objects policies
-- already call it as this role, so this should pass; it runs anyway because the
-- consequence of being wrong is that uploads stop working, and it is cheaper to
-- abort the push than to diagnose that afterwards.
do $$
begin
  if to_regprocedure('storage.foldername(text)') is null then
    raise exception
      'storage.foldername(text) does not exist; the policy below cannot be enforced';
  end if;

  if not has_schema_privilege('authenticated', 'storage', 'usage')
     or not has_function_privilege(
           'authenticated', 'storage.foldername(text)', 'execute') then
    raise exception
      'authenticated cannot execute storage.foldername(text); the policy below would refuse every note image insert, not just cross-user ones';
  end if;
end $$;

drop policy if exists note_images_insert on public.note_images;
create policy note_images_insert on public.note_images
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = (select auth.uid())
    )
    and (storage.foldername(storage_path))[1] = (select auth.uid())::text
  );

-- Read the installed policy back out of the catalogue and print it. This is a
-- narrow claim, so that it is not mistaken for a wider one: it confirms Postgres
-- parsed and stored the three conjuncts as written, and the NOTICE puts the
-- decompiled expression in the push output where it can be compared by eye. It
-- cannot detect a policy edited by hand on the project, because the `drop policy`
-- above has already removed it by this point. docs/schema.sql section 10 has the
-- standalone query for that, which reads without overwriting first.
do $$
declare
  live_check text;
begin
  select pg_get_expr(pol.polwithcheck, pol.polrelid)
    into live_check
    from pg_policy pol
   where pol.polrelid = 'public.note_images'::regclass
     and pol.polname = 'note_images_insert';

  if live_check is null then
    raise exception
      'note_images_insert is missing, or has no WITH CHECK, on public.note_images';
  end if;

  if live_check not like '%foldername%' or live_check not like '%storage_path%' then
    raise exception
      'note_images_insert does not constrain storage_path; installed: %', live_check;
  end if;

  if live_check not like '%user_id%' or live_check not like '%notes%' then
    raise exception
      'note_images_insert lost an existing ownership check; installed: %', live_check;
  end if;

  raise notice 'note_images_insert WITH CHECK installed as: %', live_check;
end $$;
