-- Seed three example notes for the workspace owner.
--
-- Why this is not a plain `insert into public.notes (title, body) values (...)`:
-- notes.user_id is `not null default auth.uid()`. A migration runs as `postgres`
-- with no JWT, so auth.uid() is null there and the default would violate the
-- not-null constraint. Even if it were nullable, the notes_select policy filters
-- on `user_id = auth.uid()`, so a null-owner row would be invisible in the app.
-- The owner is therefore resolved explicitly and passed in.
--
-- Re-running is safe: rows are matched by (user_id, title) and skipped if present.

do $$
declare
  owner_id uuid;
begin
  -- Single-user workspace: the first registered account owns the seed data.
  select id into owner_id
  from auth.users
  order by created_at
  limit 1;

  -- Fail loudly rather than inserting nothing. A silent no-op would still be
  -- recorded as applied, so the seeds would never appear even after signing up.
  if owner_id is null then
    raise exception
      'auth.users is empty — sign up in the app first, then apply this migration.';
  end if;

  insert into public.notes (user_id, title, body)
  select owner_id, v.title, v.body
  from (values
    ('Shopping list', 'Milk, eggs, bread'),
    ('Meeting notes', 'Discussed Q2 priorities'),
    ('Ideas',         'Redesign the onboarding flow')
  ) as v(title, body)
  where not exists (
    select 1
    from public.notes n
    where n.user_id = owner_id
      and n.title = v.title
  );
end $$;
