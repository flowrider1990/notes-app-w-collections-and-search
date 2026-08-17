-- Server-side full-text search over note titles and bodies.
--
-- A generated column rather than a trigger-maintained one: Postgres keeps it in
-- step with title and body automatically, so no application code and no trigger
-- can forget to update it.
--
-- The GIN index is the point of the exercise. `body ilike '%term%'` cannot use an
-- index and scans every row; `search_vector @@ to_tsquery(...)` does an index
-- lookup.
--
-- 'english' is fixed here and must match the `config` passed from supabase-js.
-- Building the vector with one configuration and querying it with another
-- silently returns nothing, because the stems will not line up.
--
-- Written to be idempotent, like docs/schema.sql, so a partial failure can be
-- re-run safely.

alter table public.notes
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored;

create index if not exists notes_search_vector_idx
  on public.notes using gin (search_vector);
