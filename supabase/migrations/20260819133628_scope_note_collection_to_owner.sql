-- W2 — a note may only reference a collection owned by the same user.
--
-- `notes.collection_id` was constrained by a plain foreign key and nothing else. The
-- key is no help here: Postgres runs referential-integrity checks as the constraint
-- owner and bypasses RLS, so a reference to a collection the caller cannot see still
-- validates. `notes_insert` and `notes_update` checked only `user_id`, so a caller
-- who learned another user's collection uuid could attach their own note to it — and
-- `public.shared_collection()` joined notes to collections without comparing owners,
-- so that note then rendered on the victim's anonymous /share/<token> page.
--
-- Three changes, deliberately overlapping:
--
--   1. A composite foreign key (collection_id, user_id) -> collections (id, user_id).
--      Structural: it holds for every role, including any future write that does not
--      go through RLS at all.
--   2. The `notes_insert` / `notes_update` policies gain the same requirement, so the
--      app path fails at the policy with a message about the row it tried to write
--      rather than at the key.
--   3. `public.shared_collection()` requires note and collection to share an owner,
--      so even a row that predates this migration cannot surface on someone else's
--      share link.
--
-- Idempotent throughout: `add constraint` has no `if not exists`, so each one is
-- guarded with a `pg_constraint` lookup.

-- ============================================================
-- 1. Composite foreign key
-- ============================================================

-- A composite foreign key needs a unique constraint on exactly its referenced
-- columns. `id` alone is already the primary key, so this adds no new guarantee —
-- it exists to give the key below something to point at.
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

-- Replaces the single-column key created with the table. `on delete set null
-- (collection_id)` is the column-list form (Postgres 15+): deleting a collection must
-- clear the reference without touching `user_id`, which is `not null` — the plain
-- `set null` would try to null both columns and fail.
--
-- The key is MATCH SIMPLE, so a row with `collection_id is null` is exempt and an
-- uncategorised note stays legal.
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

-- ============================================================
-- 2. Policies
-- ============================================================
-- `collection_id is null` first, so an uncategorised note never runs the subquery.
-- The `exists` reads `public.collections` under the caller's own RLS, and asks for
-- the owner explicitly as well — either alone would do, and both together mean this
-- policy does not silently depend on `collections_select` staying as it is.

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

-- `using` is deliberately left as it was. It decides which rows may be updated at
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

-- ============================================================
-- 3. The share function
-- ============================================================
-- Unchanged but for `n.user_id = c.user_id`. Everything else about it is load
-- bearing and is repeated here because `create or replace function` rewrites the
-- whole body: `security definer` with `set search_path = ''`, every reference
-- schema-qualified, and the grant list restated after the replace.

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
   and n.user_id = c.user_id
   and not n.archived
  where c.share_token = token
  order by n.pinned desc nulls last, n.created_at desc;
$$;

revoke all on function public.shared_collection(uuid) from public;
grant execute on function public.shared_collection(uuid) to anon, authenticated;
