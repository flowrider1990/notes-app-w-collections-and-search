-- Notes Workspace — schema
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Written to be idempotent, so it is safe to re-run after a partial failure.
--
-- Order matters: collections and tags before notes, notes before note_tags.

-- ============================================================
-- 1. Tables
-- ============================================================

create table if not exists public.collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.notes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection_id  uuid references public.collections(id) on delete set null,
  title          text not null default '',
  body           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Join table. Composite primary key prevents duplicate tag assignments.
-- Cascades on both sides so deleting a note or a tag never orphans a join row.
create table if not exists public.note_tags (
  note_id  uuid not null references public.notes(id) on delete cascade,
  tag_id   uuid not null references public.tags(id) on delete cascade,
  primary key (note_id, tag_id)
);

-- ============================================================
-- 2. Indexes
-- ============================================================
-- Foreign keys are not indexed automatically in Postgres.

create index if not exists notes_user_id_idx        on public.notes (user_id);
create index if not exists notes_collection_id_idx  on public.notes (collection_id);
create index if not exists notes_updated_at_idx     on public.notes (updated_at desc);
create index if not exists collections_user_id_idx  on public.collections (user_id);
create index if not exists tags_user_id_idx         on public.tags (user_id);
create index if not exists note_tags_tag_id_idx     on public.note_tags (tag_id);

-- ============================================================
-- 3. updated_at trigger
-- ============================================================
-- Kept in the database so application code cannot forget it.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. Row Level Security
-- ============================================================
-- Enable RLS, then add policies. Enabling without policies makes every query
-- return an empty array with error: null, which looks like an empty database.

alter table public.collections enable row level security;
alter table public.tags        enable row level security;
alter table public.notes       enable row level security;
alter table public.note_tags   enable row level security;

-- Owner-scoped policies on the three base tables.
-- Separate policies per command so the intent is explicit and auditable.

-- collections
drop policy if exists collections_select on public.collections;
create policy collections_select on public.collections
  for select using (user_id = auth.uid());

drop policy if exists collections_insert on public.collections;
create policy collections_insert on public.collections
  for insert with check (user_id = auth.uid());

drop policy if exists collections_update on public.collections;
create policy collections_update on public.collections
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists collections_delete on public.collections;
create policy collections_delete on public.collections
  for delete using (user_id = auth.uid());

-- tags
drop policy if exists tags_select on public.tags;
create policy tags_select on public.tags
  for select using (user_id = auth.uid());

drop policy if exists tags_insert on public.tags;
create policy tags_insert on public.tags
  for insert with check (user_id = auth.uid());

drop policy if exists tags_update on public.tags;
create policy tags_update on public.tags
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists tags_delete on public.tags;
create policy tags_delete on public.tags
  for delete using (user_id = auth.uid());

-- notes
drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select using (user_id = auth.uid());

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert with check (user_id = auth.uid());

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes
  for delete using (user_id = auth.uid());

-- note_tags has no user_id of its own. Ownership is derived from the parent note.
-- Without these, tag assignment silently returns nothing.

drop policy if exists note_tags_select on public.note_tags;
create policy note_tags_select on public.note_tags
  for select using (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = auth.uid()
    )
  );

drop policy if exists note_tags_insert on public.note_tags;
create policy note_tags_insert on public.note_tags
  for insert with check (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = auth.uid()
    )
    and exists (
      select 1 from public.tags t
      where t.id = note_tags.tag_id and t.user_id = auth.uid()
    )
  );

drop policy if exists note_tags_delete on public.note_tags;
create policy note_tags_delete on public.note_tags
  for delete using (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = auth.uid()
    )
  );

-- ============================================================
-- 5. Full-text search — optional task #2
-- ============================================================
-- Left commented out. Uncomment and re-run only when that task starts, so the
-- core build is not blocked by it.
--
-- alter table public.notes
--   add column if not exists search_vector tsvector
--   generated always as (
--     to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
--   ) stored;
--
-- create index if not exists notes_search_vector_idx
--   on public.notes using gin (search_vector);
--
-- Query shape from supabase-js:
--   .from('notes').select('*').textSearch('search_vector', term, { type: 'websearch' })

-- ============================================================
-- 6. Verification
-- ============================================================
-- Run these after the above. Expect four rows from the first, and policy rows
-- for all four tables from the second.

-- select table_name from information_schema.tables
--   where table_schema = 'public' and table_name in ('notes','collections','tags','note_tags');

-- select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' order by tablename, cmd;
