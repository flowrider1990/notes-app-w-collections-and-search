-- Notes Workspace — schema
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Written to be idempotent, so it is safe to re-run after a partial failure.
--
-- Order matters: collections and tags before notes, notes before note_tags.

-- ============================================================
-- 1. Tables
-- ============================================================

-- `share_token` null means private. A non-null uuid makes the collection readable
-- by anyone holding the link, through public.shared_collection() in section 6 —
-- not through an RLS policy. Unsharing sets it back to null and invalidates every
-- link handed out.
-- Added later by supabase/migrations/20260812130100_add_collection_share_token.sql.
create table if not exists public.collections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null,
  share_token  uuid,
  created_at   timestamptz not null default now(),
  unique (user_id, name)
);

-- Nulls are distinct in Postgres, so many unshared collections coexist. A unique
-- index rather than a constraint, so `if not exists` applies.
create unique index if not exists collections_share_token_key
  on public.collections (share_token);

-- `color` is one of a fixed palette of ten. A new tag created from a note gets a
-- colour hashed from its name; the sidebar's tag manager then lets the user pick
-- any of them. The check constraint keeps an unknown name out, since it would
-- render as an unstyled pill rather than failing visibly.
-- Added by supabase/migrations/20260812111118_add_tag_color.sql and widened from
-- six colours to ten by 20260818120415_expand_tag_palette.sql.
--
-- KEEP IN SYNC with TAG_COLORS in lib/tag-colors.ts. The list lives in both
-- places and nothing enforces the pairing: adding a colour there without a
-- migration here makes tag creation fail at runtime on 23514, which surfaces
-- only as "Could not create tag".
create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null default 'slate'
                check (
                  color in ('slate', 'red', 'orange', 'amber', 'green',
                            'teal', 'blue', 'indigo', 'violet', 'pink')
                ),
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- The inline check above only applies when the table is created. On a database that
-- predates the ten-colour palette the constraint is replaced here, so this file
-- lands on the current state whether it is run fresh or over an existing schema.
alter table public.tags
  drop constraint if exists tags_color_check;

alter table public.tags
  add constraint tags_color_check
  check (
    color in ('slate', 'red', 'orange', 'amber', 'green',
              'teal', 'blue', 'indigo', 'violet', 'pink')
  );

-- `pinned` floats a note to the top of its collection, above the normal
-- `created_at desc` order — the ordering itself lives in the query, not here.
-- `archived` hides a note from the main sidebar view without deleting it: a flag
-- rather than a second table, so the note keeps its id, collection and tags and
-- restoring it is one boolean flip.
-- Both added later by supabase/migrations/20260812122955_add_note_pinned_archived.sql.
create table if not exists public.notes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection_id  uuid references public.collections(id) on delete set null,
  title          text not null default '',
  body           text not null default '',
  pinned         boolean not null default false,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- A note may only reference a collection owned by the same user. The single-column
-- key above cannot express that, and it would not help if it could: referential
-- integrity checks run as the constraint owner and bypass RLS, so a reference to a
-- collection the caller cannot see still validates. The composite key does express
-- it, and holds for every role rather than only for `authenticated`.
--
-- `on delete set null (collection_id)` is the column-list form (Postgres 15+):
-- deleting a collection clears the reference without touching `user_id`, which is
-- `not null`. MATCH SIMPLE means a row with `collection_id is null` is exempt, so an
-- uncategorised note stays legal.
--
-- Added by supabase/migrations/20260819133628_scope_note_collection_to_owner.sql.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collections'::regclass
      and conname = 'collections_id_user_id_key'
  ) then
    alter table public.collections
      add constraint collections_id_user_id_key unique (id, user_id);
  end if;
end $$;

alter table public.notes
  drop constraint if exists notes_collection_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass
      and conname = 'notes_collection_owner_fkey'
  ) then
    alter table public.notes
      add constraint notes_collection_owner_fkey
      foreign key (collection_id, user_id)
      references public.collections (id, user_id)
      on delete set null (collection_id);
  end if;
end $$;

-- Join table. Composite primary key prevents duplicate tag assignments.
-- Cascades on both sides so deleting a note or a tag never orphans a join row.
create table if not exists public.note_tags (
  note_id  uuid not null references public.notes(id) on delete cascade,
  tag_id   uuid not null references public.tags(id) on delete cascade,
  primary key (note_id, tag_id)
);

-- Recent searches, so a query can be re-run without retyping it.
-- `unique (user_id, query)` makes a repeat search bump the existing row instead of
-- duplicating it — which makes the write an upsert, and therefore requires an
-- UPDATE policy as well as INSERT in section 4.
-- Added later by supabase/migrations/20260812130200_add_search_history.sql.
create table if not exists public.search_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  query        text not null,
  searched_at  timestamptz not null default now(),
  unique (user_id, query)
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

-- Covers the only read of the history: this user's, most recent first.
create index if not exists search_history_user_searched_idx
  on public.search_history (user_id, searched_at desc);

-- One tag per name per user regardless of case. `unique (user_id, name)` alone let
-- "work" and "Work" coexist as two pills that looked identical, drew the same colour
-- (it is derived from the name) and filtered to disjoint sets of notes. `addTagToNote`
-- folds case when looking for an existing tag; this index states the same rule where
-- nothing can bypass it.
-- Added by supabase/migrations/20260817155128_fold_tag_names_case_insensitively.sql.
create unique index if not exists tags_user_id_lower_name_key
  on public.tags (user_id, lower(name));

-- ============================================================
-- 3. updated_at trigger
-- ============================================================
-- Kept in the database so application code cannot forget it.
--
-- It fires on every UPDATE, not only on title/body: flipping `pinned` or
-- `archived` bumps `updated_at` too, even though no text changed. Nothing sorts
-- on or displays `updated_at`, so this is harmless — but do not read it as
-- "last edited by hand".

-- `set search_path = ''` pins name resolution inside the function instead of leaving
-- it to whatever the caller had set. Not a hole today — `now()` comes from
-- `pg_catalog`, which is searched first regardless, and the function is
-- `security invoker`, so smuggled code would run with the caller's own privileges.
-- Pinned because that reasoning only holds while the body stays this small, and
-- because it clears `function_search_path_mutable` from `supabase db advisors`.
-- Added by supabase/migrations/20260814085033_harden_rls_policies.sql.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- `create function` grants EXECUTE to PUBLIC, and Supabase's default ACL on schema `public`
-- adds `anon` and `authenticated` by name on top of it. None of those three is written by
-- this project and none is needed: PostgreSQL checks EXECUTE on a trigger function when the
-- trigger is CREATED, not each time it fires, and `postgres` owns this one. Section 9 closes
-- the template those grants are stamped from, but only for objects created after it runs -- on
-- the live project this function was created long before, and ALTER DEFAULT PRIVILEGES never
-- reaches back to an object that already exists, so its own grants are taken back here.
--
-- Nothing reaches it today (PostgREST does not publish a function returning `trigger`), so
-- this is the last inherited grant in `public` rather than an open door. Revoking from PUBLIC
-- is the statement that matters: `anon` holds EXECUTE by name *and* through PUBLIC, so the
-- named revokes alone would leave it reachable.
--
-- Applied by supabase/migrations/20260820163152_revoke_set_updated_at_execute.sql.

revoke execute on function public.set_updated_at() from anon;
revoke execute on function public.set_updated_at() from authenticated;
revoke execute on function public.set_updated_at() from public;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. Row Level Security
-- ============================================================
-- Enable RLS, then add policies. Enabling without policies makes every query
-- return an empty array with error: null, which looks like an empty database.

alter table public.collections     enable row level security;
alter table public.tags            enable row level security;
alter table public.notes           enable row level security;
alter table public.note_tags       enable row level security;
alter table public.search_history  enable row level security;

-- Owner-scoped policies on the three base tables.
-- Separate policies per command so the intent is explicit and auditable.
--
-- Two conventions apply to every policy below, both from
-- supabase/migrations/20260814085033_harden_rls_policies.sql:
--
-- `to authenticated` — without it a policy applies to every role including `anon`.
-- An anonymous caller was already denied, because `auth.uid()` is null for `anon`
-- and `user_id = null` is null rather than true, but that is a denial by accident of
-- three-valued logic. Naming the role states the rule. Share links do not depend on
-- these policies: `/share/**` reads through the `security definer` function in
-- section 6, which bypasses RLS altogether.
--
-- `(select auth.uid())` — inside a scalar subquery it is evaluated once per
-- statement instead of once per row scanned. Same result, and it clears the
-- `auth_rls_initplan` finding from `supabase db advisors`.

-- collections
drop policy if exists collections_select on public.collections;
create policy collections_select on public.collections
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists collections_insert on public.collections;
create policy collections_insert on public.collections
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists collections_update on public.collections;
create policy collections_update on public.collections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists collections_delete on public.collections;
create policy collections_delete on public.collections
  for delete to authenticated using (user_id = (select auth.uid()));

-- tags
drop policy if exists tags_select on public.tags;
create policy tags_select on public.tags
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists tags_insert on public.tags;
create policy tags_insert on public.tags
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists tags_update on public.tags;
create policy tags_update on public.tags
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists tags_delete on public.tags;
create policy tags_delete on public.tags
  for delete to authenticated using (user_id = (select auth.uid()));

-- notes
drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select to authenticated using (user_id = (select auth.uid()));

-- `collection_id` is checked as well as `user_id`: a note may only point at a
-- collection its own owner holds. Without it a caller who learned another user's
-- collection uuid could attach their note to it, and the note then rendered on that
-- user's anonymous share page. `collection_id is null` is tested first so an
-- uncategorised note never runs the subquery.
drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      collection_id is null
      or exists (
        select 1 from public.collections c
        where c.id = notes.collection_id
          and c.user_id = (select auth.uid())
      )
    )
  );

-- `using` is deliberately left owner-only. It decides which rows may be updated at
-- all, and adding the collection test there would make a row that already holds a
-- foreign collection_id impossible to edit — including impossible to repair.
drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      collection_id is null
      or exists (
        select 1 from public.collections c
        where c.id = notes.collection_id
          and c.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes
  for delete to authenticated using (user_id = (select auth.uid()));

-- note_tags has no user_id of its own. Ownership is derived from the parent note.
-- Without these, tag assignment silently returns nothing.

drop policy if exists note_tags_select on public.note_tags;
create policy note_tags_select on public.note_tags
  for select to authenticated using (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = (select auth.uid())
    )
  );

drop policy if exists note_tags_insert on public.note_tags;
create policy note_tags_insert on public.note_tags
  for insert to authenticated with check (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tags t
      where t.id = note_tags.tag_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists note_tags_delete on public.note_tags;
create policy note_tags_delete on public.note_tags
  for delete to authenticated using (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = (select auth.uid())
    )
  );

-- search_history. The UPDATE policy is load-bearing: recording a search upserts on
-- (user_id, query), and without it the conflict path is denied and the write
-- silently does nothing.

drop policy if exists search_history_select on public.search_history;
create policy search_history_select on public.search_history
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists search_history_insert on public.search_history;
create policy search_history_insert on public.search_history
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists search_history_update on public.search_history;
create policy search_history_update on public.search_history
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists search_history_delete on public.search_history;
create policy search_history_delete on public.search_history
  for delete to authenticated using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- public.rls_auto_enable() — the safety net under all of the above
-- ------------------------------------------------------------
-- An event trigger that enables RLS on every table created in `public`, so a table
-- added without a policy fails closed (no rows to anyone) instead of open. It predates
-- these migrations and used to live only in the database; it is now also created by
-- supabase/migrations/20260814085000_add_rls_auto_enable.sql, dated deliberately ahead
-- of the harden migration that revokes on it, so that revoke has a function to act on
-- instead of raising 42883.
--
-- That closes one ordering gap; it does not make the migrations self-sufficient. This
-- file is still step 1 of Supabase setup in README.md: the base tables and
-- public.set_updated_at() are created here and nowhere else, so `supabase/migrations`
-- alone cannot rebuild the database.
--
-- It enables RLS and nothing else. A new table still needs its own policies, or
-- every query against it returns `[]` with `error: null`.
--
-- The `revoke` matters: `create function` grants execute to PUBLIC, which put a
-- `security definer` function owned by `postgres` on the REST API for `anon` at
-- `/rest/v1/rpc/rls_auto_enable` — reported by `supabase db advisors` as
-- `anon_security_definer_function_executable`. Calling it that way fails anyway,
-- since `pg_event_trigger_ddl_commands()` only works inside an event trigger, and
-- event triggers fire as the owner without consulting these grants — so revoking
-- closes the endpoint and breaks nothing.
-- Revoked by supabase/migrations/20260814085033_harden_rls_policies.sql.
--
-- Written out in full rather than described, because this whole file has to run
-- top to bottom in the dashboard SQL editor: a `revoke` on a function that was
-- never created raises 42883 and takes every statement above it down with it.

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from public;
grant execute on function public.rls_auto_enable() to service_role;

-- The function only runs when something calls it, and nothing does except this
-- trigger. `ensure_rls` is the name it carries in the live project.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end;
$$;

-- ============================================================
-- 5. Full-text search
-- ============================================================
-- A generated column, so Postgres keeps it in step with title and body and no
-- application code or trigger can forget to. The GIN index is the point: an
-- `ilike '%term%'` cannot use an index and scans every row.
--
-- 'english' is fixed here and must match the `config` supabase-js passes. Building
-- the vector with one configuration and querying it with another returns nothing
-- at all, because the stems do not line up.
-- Added by supabase/migrations/20260812130000_add_notes_search_vector.sql.

alter table public.notes
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored;

create index if not exists notes_search_vector_idx
  on public.notes using gin (search_vector);

-- Query shape from supabase-js. Omitting `type` is what makes it emit a raw
-- to_tsquery, which is required for the `:*` prefix that search-as-you-type needs:
--   .textSearch('search_vector', 'shopp:*', { config: 'english' })
-- The query string is built by toTsQuery() in lib/search-query.ts, which strips
-- tsquery operators out of user input — raw text reaching to_tsquery raises 42601.

-- ============================================================
-- 6. Public share access
-- ============================================================
-- The ONLY path by which an unauthenticated visitor can read anything here, and
-- deliberately a function rather than an RLS policy.
--
-- A policy permissive enough to serve a share link — `using (share_token is not
-- null)` for the anon role — would also let a stranger select every shared
-- collection and read the tokens straight out of the table. Taking the token as an
-- argument leaks nothing to a caller who lacks it, and leaves RLS untouched
-- everywhere.
--
-- No service-role key is involved, so CLAUDE.md rule 5 still holds. This function
-- is the one sanctioned, token-gated bypass.
--
-- `security definer` runs as the owner and so bypasses RLS. `set search_path = ''`
-- with every reference schema-qualified is what keeps that from being a
-- search-path injection hole.
--
-- LEFT join on purpose: with an inner join a shared collection holding no notes
-- returns zero rows, indistinguishable from an unknown token, so an empty
-- collection would render as 404.
--
-- Output columns are prefixed so they cannot collide with the source columns — in
-- a `returns table` function those names are also visible as variables.

create or replace function public.shared_collection(token uuid)
returns table (
  collection_name text,
  note_id uuid,
  note_title text,
  note_body text
)
language sql
security definer
set search_path = ''
stable
as $$
  select c.name, n.id, n.title, n.body
  from public.collections c
  left join public.notes n
    on n.collection_id = c.id
   -- Same owner, or a note attached to this collection by someone else would render
   -- on its share page. Belt to the composite foreign key's braces: this also covers
   -- any row that predates that key.
   and n.user_id = c.user_id
   and not n.archived
  where c.share_token = token
  order by n.pinned desc nulls last, n.created_at desc;
$$;

-- `create function` grants execute to PUBLIC by default; revoke, then grant
-- deliberately so the list is explicit rather than inherited.
revoke all on function public.shared_collection(uuid) from public;
grant execute on function public.shared_collection(uuid) to anon, authenticated;

-- ============================================================
-- 7. Image attachments
-- ============================================================
-- Files in Supabase Storage, rows here recording which note each belongs to. No
-- image bytes in Postgres: a base64 column would bloat every read of the row,
-- bypass the CDN, and break outright on a photograph.
--
-- The bucket is **private**. Rendering an attachment needs a signed URL minted from
-- the owner's session, which is what keeps the anonymous read surface exactly where
-- section 6 leaves it — one token-gated function, and nothing else. Shared
-- collections deliberately show title and body only, never images.
--
-- Object layout is `{user_id}/{note_id}/{uuid}.{ext}`. The storage policies match on
-- that first segment, so a user can only reach their own prefix. The uuid filename
-- is deliberate: an uploaded filename from a client has no business becoming a path,
-- and two photos called IMG_0001.jpg must not collide.
--
-- Added by supabase/migrations/20260817145538_add_note_images.sql.

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

-- INSERT, SELECT and DELETE only. Nothing overwrites an object — each upload gets a
-- fresh uuid name — so there is no upsert, and upsert is the one operation that
-- would also need UPDATE.

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

-- `storage_path` is unique, so a double submit cannot record the same file twice.
-- Cascades from `notes` — but Postgres cannot cascade into Storage, so `deleteNote`
-- in lib/db/ reads the paths, deletes the note, and only then removes the objects. A
-- row vanishing here does not free the file. That order is chosen on purpose: files
-- first would risk destroying them and then failing to delete the note, which is
-- irreversible loss, where this way the worst case is orphaned objects.

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

alter table public.note_images enable row level security;

-- INSERT checks the parent note as well as the owner, so a row cannot be attached to
-- someone else's note by passing its id. No UPDATE policy: an attachment row is only
-- ever created and deleted, and a policy for an operation nothing performs would only
-- widen the surface.

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

-- ============================================================
-- 8. Table privileges
-- ============================================================
-- Supabase's stock grant hands every table in `public` to `anon` with the same full
-- privilege set as `authenticated`. Nothing leaks through it — `anon` holds no policy on
-- any of these tables and RLS is on for all six, so every row is denied — with one
-- exception: TRUNCATE is not filtered by RLS, because policies are evaluated per row and
-- TRUNCATE removes rows without visiting them. For that one command the grant is the only
-- control, so it is revoked rather than relied upon.
--
-- The same reasoning reaches `authenticated`, so TRUNCATE is revoked there too. That role is
-- what every signed-in browser session assumes, and RLS does not constrain the one command it
-- does not filter: `truncate public.notes` would take every user's notes, not the caller's rows.
-- Nothing in the app can issue one -- PostgREST has no TRUNCATE verb -- and revoking it means
-- the six tables no longer depend on that staying true. `authenticated` keeps SELECT, INSERT,
-- UPDATE and DELETE, which are how the app works and are all filtered by section 4's policies.
--
-- No policy changes in this section, and `service_role` and `postgres` keep everything.
--
-- Share links are unaffected. `public.shared_collection(uuid)` in section 6 is
-- `security definer` owned by `postgres`, so it reads `notes` and `collections` with the
-- owner's rights. An anonymous visitor needs `usage` on schema `public` and `execute` on
-- that function; neither is a table grant and neither is revoked here.
--
-- Applied by supabase/migrations/20260820152052_revoke_anon_table_grants.sql (anon) and
-- supabase/migrations/20260820164046_revoke_authenticated_truncate.sql (authenticated).
--
-- This covers the tables that exist. The template new tables are stamped from is a separate
-- thing, and section 9 closes both halves of it — a table added after that arrives with nothing
-- for `anon` and without TRUNCATE for `authenticated`. Neither list below needs a line adding by
-- hand when a seventh table appears.

revoke all privileges on table public.collections    from anon;
revoke all privileges on table public.note_images    from anon;
revoke all privileges on table public.note_tags      from anon;
revoke all privileges on table public.notes          from anon;
revoke all privileges on table public.search_history from anon;
revoke all privileges on table public.tags           from anon;

revoke truncate on table public.collections    from authenticated;
revoke truncate on table public.note_images    from authenticated;
revoke truncate on table public.note_tags      from authenticated;
revoke truncate on table public.notes          from authenticated;
revoke truncate on table public.search_history from authenticated;
revoke truncate on table public.tags           from authenticated;

-- ============================================================
-- 9. Default privileges
-- ============================================================
-- Sections 6 and 8 fix the privileges on objects that exist. This one fixes the template
-- every future object in `public` is stamped from, which is a different thing and was the
-- gap behind both of them.
--
-- Supabase ships schema `public` with default ACLs that hand the full set to `anon` and to
-- `authenticated`, from two granting roles (`postgres` and `supabase_admin`):
--
--     objtype 'f' (functions): {postgres=X,        anon=X,        authenticated=X,        service_role=X}
--     objtype 'r' (tables):    {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
--
-- The functions half is the sharp edge. `create function` in `public` produces an endpoint at
-- /rest/v1/rpc/<name> that `anon` can call, with no `grant` written anywhere — and a
-- `security definer` function runs as its owner with RLS bypassed. That is the exact shape
-- this project asks contributors to write (see `shared_collection` in section 6), so the
-- default works against the convention. Section 4's `rls_auto_enable` revoke at the top of
-- this file exists only because of it.
--
-- After this, a new function is callable only once someone writes an explicit `grant execute`,
-- and a new table arrives with nothing for `anon`. `authenticated` keeps its table defaults
-- except TRUNCATE: every table here is meant to be reachable by a signed-in user and gated by
-- RLS, which is true of SELECT, INSERT, UPDATE and DELETE and is exactly what is not true of
-- TRUNCATE — policies are evaluated per row and TRUNCATE never visits one, so section 8's
-- argument applies to the template as well as to the six tables it already fixed. Without this
-- the seventh table would arrive with TRUNCATE restored. `service_role` keeps everything — it is
-- the trusted server-side key and never reaches a browser.
--
-- ALTER DEFAULT PRIVILEGES is prospective only. No existing ACL changes, so
-- `shared_collection` stays executable by `anon`, `rls_auto_enable` stays not, and the six
-- tables keep the grants section 8 left them with. No RLS policy and nothing in `storage` is
-- touched. Sequences are left alone throughout: their defaults carry no TRUNCATE to revoke, so
-- they are out of scope here — not assessed and cleared. That row still reads
-- `{postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU}`.
--
-- A default ACL is keyed to the role that CREATES the object, and the two granting roles are
-- therefore not equally important here.
--
-- `postgres` is the row that governs everything this project makes, since migrations connect
-- as `postgres`. Those two statements are mandatory: unguarded, no exception handler, and any
-- failure aborts the migration. A silent skip would leave the hole open while the migration
-- history claimed otherwise.
--
-- `supabase_admin` governs extensions and Supabase-managed objects, and nothing in this
-- repository. Altering its defaults needs ADMIN OPTION on that role since PostgreSQL 16 (this
-- project is on 17.6), which `postgres` does not hold on a hosted project and cannot grant
-- itself. That pass is therefore pre-checked and, when not permitted, skipped with a WARNING
-- naming what was and was not done. The attempt is still wrapped, but the handler catches
-- `insufficient_privilege` and nothing else — a syntax error or any other failure propagates
-- and aborts, the same as the `postgres` half.
--
-- Applied by supabase/migrations/20260820154942_close_public_default_privileges.sql, and the
-- TRUNCATE line by supabase/migrations/20260820164907_revoke_authenticated_truncate_default.sql.
-- The effective statements — the `postgres` ones unconditional, the `supabase_admin` ones
-- conditional. They are commented out because this section cannot be applied by running this
-- file: the `supabase_admin` pair needs the guarded block those migrations carry, and a run that
-- silently skipped it would be worse than no run. Apply section 9 with `supabase db push`, not by
-- pasting this file into the SQL editor.

-- alter default privileges for role postgres       in schema public revoke execute  on functions from anon, authenticated;
-- alter default privileges for role postgres       in schema public revoke all      on tables    from anon;
-- alter default privileges for role postgres       in schema public revoke truncate on tables    from authenticated;
-- alter default privileges for role supabase_admin in schema public revoke execute  on functions from anon, authenticated;
-- alter default privileges for role supabase_admin in schema public revoke all      on tables    from anon;

-- ============================================================
-- 10. Verification
-- ============================================================
-- Run these after the above. Expect six rows from the first, and policy rows for all
-- six tables from the second.

-- select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('notes','collections','tags','note_tags','search_history','note_images');

-- The bucket must exist and must not be public: a public bucket would make every
-- attachment readable by anyone holding a URL, which is a second anonymous read path.
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets
--   where id = 'note-images';

-- Three storage policies, all scoped to the bucket and the owner's folder.
-- select policyname, cmd, roles from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like 'note_images_storage%';

-- Every row should read {authenticated}; a {public} row is a policy that predates
-- the hardening migration and still applies to anon.
-- select tablename, policyname, cmd, roles from pg_policies
--   where schemaname = 'public' order by tablename, cmd;

-- The share function must be executable by anon, and nothing else new should be.
-- select p.proname, p.prosecdef, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute')
--   from pg_proc p, (select 'anon' as rolname union select 'authenticated') r
--   where p.proname = 'shared_collection';

-- After section 8, anon must hold no table privileges at all: expect zero rows here.
-- select table_name, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and grantee = 'anon';

-- authenticated keeps the four commands the app runs, and must hold no TRUNCATE. Expect six
-- rows, each reading exactly DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE, and has_truncate
-- false on every one.
-- select table_name,
--        string_agg(privilege_type, ',' order by privilege_type) as privs,
--        bool_or(privilege_type = 'TRUNCATE') as has_truncate
--   from information_schema.role_table_grants
--  where table_schema = 'public' and grantee = 'authenticated'
--  group by table_name order by table_name;

-- The two grants share links actually depend on, neither of them a table grant.
-- Expect U for the schema and X for the function.
-- select has_schema_privilege('anon', 'public', 'usage')      as schema_usage,
--        has_function_privilege('anon', 'public.shared_collection(uuid)', 'execute') as fn_execute;

-- Section 9. The `postgres` rows must show no `anon=` entry at all, no `authenticated=X` on
-- the function row, and `authenticated=arwdxtm` — no `D` — on the table row. A `supabase_admin`
-- row still carrying them is the documented skip, not a regression — application objects are
-- not created by that role.
-- select pg_get_userbyid(d.defaclrole) as granting_role,
--        case d.defaclobjtype when 'r' then 'table' when 'f' then 'function'
--             else d.defaclobjtype::text end as objtype,
--        d.defaclacl::text as acl
--   from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
--  where n.nspname = 'public' and d.defaclobjtype in ('r','f')
--  order by 1, 2;

-- The prospective-only guarantee, checked against the objects that already exist.
-- Expect shared_collection true/true; rls_auto_enable and set_updated_at false/false. Only
-- the share function is meant to be callable, and only it should ever read true here.
-- select p.proname,
--        has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
--        has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('shared_collection', 'rls_auto_enable', 'set_updated_at');

-- Section 3's revoke leaves the trigger alone. Expect one row, tgenabled = 'O'.
-- select t.tgname, c.relname, t.tgenabled from pg_trigger t
--   join pg_class c on c.oid = t.tgrelid
--  where not t.tgisinternal and t.tgfoid = 'public.set_updated_at()'::regprocedure;
