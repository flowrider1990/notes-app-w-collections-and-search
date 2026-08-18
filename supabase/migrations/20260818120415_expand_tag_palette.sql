-- Widen the tag palette from six colours to ten.
--
-- The colour is now the user's choice rather than only a hash of the tag name —
-- the sidebar's tag manager offers the palette directly — and six swatches is a
-- thin set to choose from. Adds orange, teal, indigo and pink, which fill the
-- widest gaps around the wheel from the existing slate, red, amber, green, blue
-- and violet.
--
-- The new list is a superset of the old one, so every existing row still passes
-- and no data has to move.
--
-- KEEP IN SYNC with TAG_COLORS in lib/tag-colors.ts and with the inline check in
-- docs/schema.sql. Nothing enforces the pairing: a colour offered by the UI but
-- missing here fails at runtime as 23514, which the user only sees as "Could not
-- update the tag".
--
-- `add constraint` has no `if not exists` clause, and the constraint being
-- replaced already exists, so this drops first rather than guarding on
-- pg_constraint the way the original migration did. Drop-then-add is idempotent:
-- re-running it lands on the same definition.

alter table public.tags
  drop constraint if exists tags_color_check;

alter table public.tags
  add constraint tags_color_check
  check (
    color in (
      'slate',
      'red',
      'orange',
      'amber',
      'green',
      'teal',
      'blue',
      'indigo',
      'violet',
      'pink'
    )
  );
