-- Pin the filename half of a note-image object key.
--
-- 20260820181531 bound an upload to `{auth.uid()}/{a note the caller owns}/…` and
-- pinned the depth, but said nothing about the last segment, so the filename was
-- free text. This requires it to be the shape the app actually creates: a lowercase
-- v4-style uuid from `crypto.randomUUID()`, then one of the four extensions
-- `imageExtension` can return.
--
-- READ THIS BEFORE ASSUMING IT CLOSES THE ORPHAN PROBLEM. It does not. It bounds
-- the *shape* of a key, not the *number* of them: a caller can still mint unlimited
-- fresh uuids under a note they own, every one of them matching this pattern and
-- none of them carrying a `note_images` row, and can create unlimited notes to get
-- unlimited folders to do it in. What this buys is narrower — an authenticated
-- caller can no longer choose the name, so the bucket cannot accumulate
-- `payload.html` or a 200-character name, and every object in it is now uniform
-- enough that a reconciliation sweep can be written without special cases. It also
-- closes the one gap 20260820181531 recorded as open: `{uid}/{owned note}/` with a
-- trailing slash and no filename still split into two folders and was accepted
-- there, and `storage.filename` returns '' for it, which fails an anchored pattern.
-- That note in 20260820181531 is superseded; the migration file is left as it was
-- applied rather than edited after the fact.
--
-- What would actually close it is requiring a matching `note_images` row, and that
-- is not expressible *as a conjunct referencing a row that already exists*.
-- `addNoteImage` uploads the bytes first and writes the row second, so when this
-- policy runs there is no row for the new path and such a conjunct would refuse
-- every legitimate upload. The two writes cannot be folded into one transaction
-- either: the upload is an HTTP call to storage-api, which commits on its own
-- connection before the PostgREST insert starts. Deferred constraints, a foreign key
-- onto `note_images`, and any transaction-local reservation are out for that same
-- reason, not merely awkward.
--
-- Three other options were on the table and were not taken. They are written down so
-- the next reader does not conclude that only an upload rewrite was ever available:
--
--  * Write the row first as a reservation, then upload against it, with this policy
--    requiring the row. This does close it, and it flips the failure mode from an
--    invisible orphan object to a visible row with no bytes that the app lists and
--    the user can delete. It changes the upload architecture, so it belongs in a
--    decision of its own rather than folded into a policy migration.
--  * An `after insert` trigger on storage.objects that writes the `note_images` row
--    itself, which would make an orphan impossible without touching the upload
--    order. Rejected on two counts: `addNoteImage`'s own insert would then collide
--    with the unique `storage_path` and fail every upload, so the application
--    changes anyway; and storage-api fills in `metadata` after the row appears, so
--    `size_bytes` and `mime_type` — both not null — may not be readable yet. That
--    would pin this schema to storage-api internals, and the failure mode is every
--    upload breaking.
--  * A standing cap in this same WITH CHECK, counting the caller's existing objects.
--    Expressible today, with no application change, and it would bound the
--    consumption this finding is actually about — which nothing in this migration
--    does. Left out because a cap is a decision about how much a user may store,
--    and that wants a number chosen deliberately rather than invented inside a
--    security fix.
--
-- A reconciliation sweep is the fourth option, with a trap worth recording: deleting
-- rows from storage.objects in SQL does not reclaim the bytes, so a pg_cron-only
-- sweep hides orphans instead of removing them. Reclaiming them needs a call back
-- into the Storage API.
--
-- **This couples the policy to `ALLOWED_IMAGE_TYPES` in lib/db/index.ts**, and
-- nothing but this comment links the two — the same trap `TAG_COLORS` and
-- `tags_color_check` carry, so it is worth spelling out the same way. The four
-- extensions here are the four *values* of that map, not its keys: `image/jpeg`
-- maps to `jpg`, so `jpeg` is deliberately absent. Adding a fifth image type to the
-- app without adding its extension here makes uploads of that type fail at Storage
-- with an RLS error, which the user only ever sees as "Could not attach the image."
--
-- Lowercase only, in both halves. `crypto.randomUUID()` is specified to emit
-- lowercase hex, and the extensions come from a literal map, so the app cannot
-- produce anything else. All three objects currently in the bucket match.
--
-- `storage.filename` is used rather than `split_part(name, '/', 3)`: the policy
-- already depends on `storage.foldername`, so this adds no new class of dependency,
-- and it says what it means. `authenticated` can execute it — checked below.
--
-- The other four conjuncts are carried over unchanged from 20260820181531. SELECT
-- and DELETE are not touched.

-- Pre-flight. Each of these would refuse every upload rather than only the misshapen
-- ones: losing the read on public.notes, or losing either of the two storage
-- functions the policy calls. Both are checked — the earlier version named "the
-- function" and tested only one.
--
-- The existence test and the privilege test are separate statements rather than one
-- `or`: `has_function_privilege` raises undefined_function on a missing function, and
-- Postgres promises no more about `or` evaluation order than about the `and` order
-- 20260820181531 works around. A loop gives the two checks a defined sequence.
do $$
declare
  fn text;
begin
  if not has_schema_privilege('authenticated', 'public', 'usage') then
    raise exception
      'authenticated lacks usage on schema public; the policy below would refuse every note image upload';
  end if;

  if not has_table_privilege('authenticated', 'public.notes', 'select') then
    raise exception
      'authenticated cannot select public.notes; the policy below would refuse every note image upload';
  end if;

  for fn in
    select unnest(array['storage.filename(text)', 'storage.foldername(text)'])
  loop
    if to_regprocedure(fn) is null then
      raise exception '% does not exist; the policy below cannot be enforced', fn;
    end if;

    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception
        'authenticated cannot execute %; the policy below would refuse every note image upload',
        fn;
    end if;
  end loop;
end $$;

drop policy if exists note_images_storage_insert on storage.objects;
create policy note_images_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-images'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
        from public.notes n
       where n.id::text = (storage.foldername(name))[2]
         and n.user_id = (select auth.uid())
    )
    and storage.filename(name) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|webp|gif)$'
  );

-- Report, rather than require, that what is already in the bucket matches the rule
-- now guarding new writes. A warning and not an exception, because "the app wrote a
-- shape this pattern does not describe" is not the only way to get one: uploads made
-- as service_role or from the dashboard never passed this policy, and the Storage UI
-- writes a `.emptyFolderPlaceholder` object whenever someone creates a folder. None
-- of those match, none of them are a fault in this pattern, and none of them is a
-- reason to fail a push on an otherwise healthy project. The placeholder is excluded
-- outright; anything else is named so an operator can look.
--
-- Existing objects keep working regardless: this policy is INSERT-only, so it is
-- never consulted for reads or deletes of what is already there.
do $$
declare
  offending text;
  offenders integer;
begin
  select count(*), min(o.name)
    into offenders, offending
    from storage.objects o
   where o.bucket_id = 'note-images'
     and storage.filename(o.name) <> '.emptyFolderPlaceholder'
     and storage.filename(o.name) !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|webp|gif)$';

  if offenders > 0 then
    raise warning
      '% note-images object(s) do not match the new filename rule and could not be re-uploaded as-is; first: %',
      offenders, offending;
  end if;
end $$;

-- Read the installed policy back. As before this cannot detect a hand edit — the
-- drop above removed it — so the claim is only that Postgres stored all six
-- conjuncts. docs/schema.sql section 10 has the standalone query.
do $$
declare
  live_check text;
begin
  select pg_get_expr(pol.polwithcheck, pol.polrelid)
    into live_check
    from pg_policy pol
   where pol.polrelid = 'storage.objects'::regclass
     and pol.polname = 'note_images_storage_insert';

  if live_check is null then
    raise exception
      'note_images_storage_insert is missing, or has no WITH CHECK, on storage.objects';
  end if;

  -- The pattern's own tail and one extension, not just the word "filename": a
  -- mangled uuid class or a truncated extension list would otherwise still read as
  -- installed.
  if live_check not like '%filename%'
     or live_check not like '%{12}%'
     or live_check not like '%webp%' then
    raise exception
      'note_images_storage_insert does not constrain the filename to the expected shape; installed: %',
      live_check;
  end if;

  if live_check not like '%array_length%'
     or live_check not like '%notes%'
     or live_check not like '%user_id%'
     or live_check not like '%note-images%'
     or live_check not like '%foldername%' then
    raise exception
      'note_images_storage_insert lost one of the checks from 20260820181531; installed: %',
      live_check;
  end if;

  raise notice 'note_images_storage_insert WITH CHECK installed as: %', live_check;
end $$;
