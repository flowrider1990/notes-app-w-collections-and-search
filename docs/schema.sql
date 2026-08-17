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

-- `color` is one of a small fixed palette, assigned by application code when the
-- tag is first created. The check constraint keeps an unknown name out, since it
-- would render as an unstyled pill rather than failing visibly.
-- Added later by supabase/migrations/20260812111118_add_tag_color.sql.
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
                check (color in ('slate', 'red', 'amber', 'green', 'blue', 'violet')),
  created_at  timestamptz not null default now(),
  unique (user_id, name)
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

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

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
-- added without a policy fails closed (no rows to anyone) instead of open. It
-- predates these migrations and lives only in the database; it is recorded here
-- because docs/schema.sql is the current-state reference, and because a reader who
-- finds RLS already enabled on a brand-new table should know why.
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

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from public;

-- The function only runs when something calls it, and nothing does except this
-- trigger. `ensure_rls` is the name it carries in the live project.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
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
   and not n.archived
  where c.share_token = token
  order by n.pinned desc nulls last, n.created_at desc;
$$;

-- `create function` grants execute to PUBLIC by default; revoke, then grant
-- deliberately so the list is explicit rather than inherited.
revoke all on function public.shared_collection(uuid) from public;
grant execute on function public.shared_collection(uuid) to anon, authenticated;

-- ============================================================
-- 7. Verification
-- ============================================================
-- Run these after the above. Expect five rows from the first, and policy rows for
-- all five tables from the second.

-- select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('notes','collections','tags','note_tags','search_history');

-- Every row should read {authenticated}; a {public} row is a policy that predates
-- the hardening migration and still applies to anon.
-- select tablename, policyname, cmd, roles from pg_policies
--   where schemaname = 'public' order by tablename, cmd;

-- The share function must be executable by anon, and nothing else new should be.
-- select p.proname, p.prosecdef, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute')
--   from pg_proc p, (select 'anon' as rolname union select 'authenticated') r
--   where p.proname = 'shared_collection';
