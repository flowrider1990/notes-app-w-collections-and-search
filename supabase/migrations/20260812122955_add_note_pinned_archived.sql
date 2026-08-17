-- Pinned and archived notes.
--
-- `pinned` floats a note to the top of its collection, above the normal
-- `created_at desc` order. Ordering is done in the query, not here.
--
-- `archived` takes a note out of the main sidebar view without deleting it. It is
-- a flag rather than a separate table so a note keeps its id, its collection and
-- its tags while archived, and restoring it is a single boolean flip.
--
-- Both default to false, so existing rows stay unpinned and unarchived.
--
-- Written to be idempotent, like docs/schema.sql, so a partial failure can be
-- re-run safely. No `pg_constraint` guard is needed — that pattern exists for
-- named constraints, and `add column if not exists` already covers a column.
--
-- Note: the notes_set_updated_at trigger fires on every UPDATE, so pinning or
-- archiving a note bumps its updated_at even though no text changed. Accepted —
-- nothing sorts on or displays updated_at.

alter table public.notes
  add column if not exists pinned boolean not null default false;

alter table public.notes
  add column if not exists archived boolean not null default false;
