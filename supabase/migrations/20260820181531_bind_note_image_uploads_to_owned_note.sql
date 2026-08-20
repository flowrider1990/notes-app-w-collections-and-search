-- Bind an upload into note-images to a note the uploader owns.
--
-- `note_images_storage_insert` (20260817145538) checked the bucket and the first
-- path segment, so a signed-in user could only write inside their own prefix — but
-- the second segment, documented as `{note_id}`, was not checked at all and nothing
-- tied the object to a note. Anyone with a session and the publishable key could
-- call the Storage API directly and write objects under `{their uid}/anything/…`.
-- Not a cross-user hole: the first-segment rule already held.
--
-- What this closes is the *shape*, and only that. An upload must now land under a
-- note the caller owns, at the documented depth. It does not bound how many
-- objects they can write: the filename is still unconstrained, so unlimited
-- unreferenced files can go under `{uid}/{a real note id}/`, and because
-- `deleteNote` and `deleteArchivedNotes` enumerate `note_images` rows to find what
-- to remove, none of those are cleaned up when the note goes. That is a separate,
-- still-open concern — do not read this migration as having fixed it.
--
-- Three conjuncts are added to the two that were there:
--
--  * `array_length(...) = 2` pins the depth of the documented
--    `{user_id}/{note_id}/{file}` layout, so the object cannot be nested deeper
--    inside it. Not quite exact, and worth saying for parity with the note in
--    20260820171403: `{uid}/{owned note}/` with a trailing slash and no filename
--    still splits into two folders and is accepted. It is an empty-named object
--    inside the caller's own note folder, so there is nothing there to reach.
--  * the note-id segment must name a row in public.notes...
--  * ...that belongs to the caller. RLS on `notes` already scopes the subquery to
--    the caller's own rows, so this conjunct is redundant today and stated anyway,
--    the same way `note_images_insert` states it: the policy should not depend on
--    another table's policy staying the way it is.
--
-- `n.id::text = segment` rather than `n.id = segment::uuid`, deliberately. The
-- segment is attacker-controlled text, and casting it raises 22P02 on anything
-- malformed — verified: `('u/not-a-uuid/f.png')` casts to an error rather than to
-- false. Guarding the cast with a regex would not fix that, because Postgres does
-- not promise to evaluate `AND` left to right and may reach the cast first. Casting
-- the *column* instead cannot fail, and returns a clean false for a malformed
-- segment and for a path too shallow to have a second one. It gives up the index
-- on notes.id, which is the right trade here: this runs once per upload, against
-- one user's notes.
--
-- Uploads the app itself performs are unaffected. `addNoteImage` builds the key as
-- `${requireUser().id}/${noteId}/${uuid}.${ext}` from a note id read out of
-- Postgres, so segment 2 is always the canonical lowercase uuid text that
-- `n.id::text` produces. All three objects currently in the bucket are depth 2 with
-- a real note in segment 2.
--
-- SELECT and DELETE are left alone: they match on the first segment, which is what
-- keeps them the caller's own, and neither can create an object.

-- Pre-flight: the policy below reads public.notes as the invoking role, and losing
-- that would refuse every note image upload rather than only the unbound ones.
-- Both prerequisites are checked — `has_table_privilege` deliberately ignores
-- schema USAGE, so the table privilege on its own would not have been the whole
-- condition the comment claimed.
do $$
begin
  if not has_schema_privilege('authenticated', 'public', 'usage')
     or not has_table_privilege('authenticated', 'public.notes', 'select') then
    raise exception
      'authenticated cannot read public.notes; the policy below would refuse every note image upload';
  end if;
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
  );

-- Read the installed policy back and print it. As in 20260820171403 this cannot
-- detect a policy edited by hand — the drop above has already removed it — so the
-- claim is narrow: it confirms Postgres parsed and stored all five conjuncts.
-- docs/schema.sql section 10 has the standalone query that reads without
-- overwriting first.
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

  if live_check not like '%array_length%'
     or live_check not like '%notes%'
     or live_check not like '%user_id%' then
    raise exception
      'note_images_storage_insert does not bind the upload to an owned note; installed: %',
      live_check;
  end if;

  if live_check not like '%note-images%' or live_check not like '%foldername%' then
    raise exception
      'note_images_storage_insert lost the bucket or first-segment check; installed: %',
      live_check;
  end if;

  raise notice 'note_images_storage_insert WITH CHECK installed as: %', live_check;
end $$;
