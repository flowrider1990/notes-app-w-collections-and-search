-- Image attachments for notes.
--
-- The files live in Supabase Storage; this table records which note each one
-- belongs to. Nothing stores image bytes in Postgres — a base64 column would bloat
-- every row read, defeat the CDN, and blow past the row size the moment someone
-- attaches a photo.
--
-- The bucket is **private**. Reading a file needs a signed URL minted by the owner's
-- session, which keeps the anonymous read surface exactly where the audit left it:
-- one token-gated function for shared collections, and nothing else. Shared
-- collections deliberately do not show images — see docs/schema.sql section 6.
--
-- Layout inside the bucket is `{user_id}/{note_id}/{uuid}.{ext}`. The leading
-- folder is what the storage policies below match on, so a user can only ever
-- write into, read from or delete their own prefix.

-- ============================================================
-- 1. The bucket
-- ============================================================
-- Limits are enforced by Storage itself rather than only in application code: a
-- request that skips the UI still cannot land a 40 MB TIFF here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-images',
  'note-images',
  false,
  5242880, -- 5 MiB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- 2. Storage policies
-- ============================================================
-- `storage.objects` has RLS enabled by Supabase already; these add this bucket's
-- rules. Scoped by both bucket and the first path segment, so they cannot leak
-- across buckets or between users.
--
-- INSERT, SELECT and DELETE only. Nothing overwrites an object — every upload gets
-- a fresh uuid name — so there is no upsert, and an upsert is the one operation that
-- would additionally need UPDATE.

drop policy if exists note_images_storage_insert on storage.objects;
create policy note_images_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists note_images_storage_select on storage.objects;
create policy note_images_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists note_images_storage_delete on storage.objects;
create policy note_images_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ============================================================
-- 3. The table
-- ============================================================
-- `storage_path` is unique: one row per object, so a double-submit cannot record
-- the same file twice. Cascades from `notes`, which keeps the table honest — but
-- note that Postgres cannot cascade into Storage, so `deleteNote` in lib/db/ removes
-- the objects before it deletes the note. A row disappearing here does not free the
-- file on its own.

create table if not exists public.note_images (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references public.notes(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path  text not null unique,
  mime_type     text not null,
  size_bytes    integer not null,
  created_at    timestamptz not null default now()
);

create index if not exists note_images_note_id_idx on public.note_images (note_id);
create index if not exists note_images_user_id_idx on public.note_images (user_id);

-- ============================================================
-- 4. Row Level Security
-- ============================================================
-- Same conventions as every other table here: `to authenticated`, and `auth.uid()`
-- inside a scalar subquery so it is evaluated once per statement.
--
-- INSERT additionally checks the parent note, so a row cannot be attached to
-- someone else's note by passing its id. No UPDATE policy: an attachment row is
-- never edited, only created and deleted, and adding a policy for an operation
-- nothing performs would only widen the surface.

alter table public.note_images enable row level security;

drop policy if exists note_images_select on public.note_images;
create policy note_images_select on public.note_images
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists note_images_insert on public.note_images;
create policy note_images_insert on public.note_images
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = (select auth.uid())
    )
  );

drop policy if exists note_images_delete on public.note_images;
create policy note_images_delete on public.note_images
  for delete to authenticated using (user_id = (select auth.uid()));
