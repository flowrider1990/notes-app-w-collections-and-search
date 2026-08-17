-- One tag per name per user, regardless of case.
--
-- `unique (user_id, name)` let "work" and "Work" coexist. Both rendered as pills the
-- user could not tell apart — `pickTagColor` is derived from the name, so they even
-- drew the same colour — while filtering by one selected a set of notes that excluded
-- the other. Two identical-looking controls with different meanings.
--
-- `addTagToNote` in lib/db/ now folds case when it looks for an existing tag, so the
-- first spelling wins and later ones reuse it. This index is the same rule stated
-- where it cannot be bypassed: an insert from anywhere else fails with 23505, which
-- the helper already turns into a readable message.
--
-- The original `unique (user_id, name)` constraint stays. It is implied by this index
-- and costs one more B-tree, but dropping a constraint that other code may rely on
-- buys nothing here.
--
-- Verified before writing this: no existing tag differs from another only by case, so
-- the index builds without a data migration. If that ever fails on a fresh database,
-- fold the duplicates first — the surviving row should be the oldest, and `note_tags`
-- rows pointing at the loser need repointing before it is deleted.

create unique index if not exists tags_user_id_lower_name_key
  on public.tags (user_id, lower(name));
