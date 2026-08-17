-- Collection sharing by link.
--
-- `share_token` null means the collection is private. Sharing sets an unguessable
-- uuid; unsharing sets it back to null, which invalidates every link that was
-- handed out.
--
-- A unique *index* rather than a unique constraint, because `if not exists` works
-- on the former and `add constraint` has no such clause. Nulls are distinct in
-- Postgres, so any number of unshared collections coexist happily.

alter table public.collections
  add column if not exists share_token uuid;

create unique index if not exists collections_share_token_key
  on public.collections (share_token);

-- ============================================================
-- The public read path
-- ============================================================
-- This function is the ONLY way an unauthenticated visitor can read anything in
-- this database, and it is deliberately a function rather than an RLS policy.
--
-- A policy permissive enough to serve a share link -- say
-- `using (share_token is not null)` for the anon role -- would also let a
-- stranger select every shared collection and read the tokens straight out of
-- the table. Taking the token as an argument leaks nothing to a caller who does
-- not already have it, and leaves RLS untouched on every table.
--
-- No service-role key is involved, so CLAUDE.md rule 5 still holds.
--
-- `security definer` runs with the owner's rights and therefore bypasses RLS.
-- `set search_path = ''` with every reference schema-qualified is what stops that
-- being a search-path injection hole: without it, a caller who can create objects
-- could shadow `collections` and have this function read their table instead.
--
-- The join is a LEFT join on purpose. With an inner join, a shared collection
-- holding no notes returns zero rows -- indistinguishable from an unknown token,
-- so an empty shared collection would render as a 404. The left join returns one
-- row with a null note_id, which the caller filters out.
--
-- Output columns are prefixed (`note_title`, not `title`) so they cannot collide
-- with the source columns; in a `returns table` function those names are also
-- visible as variables, and a collision is an ambiguous-reference error.
--
-- Archived notes stay out of the shared view.

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

-- `create function` grants execute to PUBLIC by default. Revoke that, then grant
-- deliberately, so the grant list is explicit rather than inherited.
revoke all on function public.shared_collection(uuid) from public;
grant execute on function public.shared_collection(uuid) to anon, authenticated;
