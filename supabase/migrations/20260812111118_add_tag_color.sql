-- Give each tag a colour from a small fixed palette.
--
-- The colour is assigned by application code when a tag is first created and
-- then persisted here, so a tag keeps the same colour everywhere it appears.
--
-- A check constraint rather than free text: an unknown colour name would render
-- as an unstyled pill, which is a silent visual failure. Better a loud database
-- error. Existing rows take the default.
--
-- Written to be idempotent, like docs/schema.sql, so a partial failure can be
-- re-run safely.

alter table public.tags
  add column if not exists color text not null default 'slate';

-- `add constraint` has no `if not exists`, so it is guarded explicitly.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tags_color_check'
      and conrelid = 'public.tags'::regclass
  ) then
    alter table public.tags
      add constraint tags_color_check
      check (color in ('slate', 'red', 'amber', 'green', 'blue', 'violet'));
  end if;
end $$;
