-- Remove the direct table privileges `anon` holds on the six user-owned tables.
--
-- Every table in `public` carries Supabase's stock grant, which hands the same full set to
-- `anon` as to `authenticated`:
--
--     anon=arwdDxtm/postgres     -- INSERT SELECT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN
--
-- Nothing has leaked through it. `anon` holds no policy on any of these tables, RLS is on for
-- all six, and a role with a grant but no policy is denied every row. The grant is dead weight
-- for `select`, `insert`, `update` and `delete`.
--
-- It is not dead weight for `truncate`. TRUNCATE is not a DML statement and RLS does not filter
-- it: policies are consulted per row, and TRUNCATE removes rows without visiting them. So for
-- that one command the grant is the *only* thing standing between a caller running as `anon` and
-- an emptied table — the RLS this project relies on everywhere else does not apply. PostgREST
-- exposes no TRUNCATE verb, so there is no route to it today; this closes the grant rather than
-- continuing to depend on that remaining true.
--
-- Scope. Six tables, named explicitly rather than `all tables in schema public`, so the statement
-- says what it does and cannot silently widen onto a table added later by an extension or by
-- Supabase itself.
--
-- What is deliberately NOT touched:
--
--   * `authenticated` keeps every grant it has. This migration names one grantee.
--   * No RLS policy is altered. The policies are what actually authorise the app, and they are
--     unchanged; this only removes a privilege that no policy was ever paired with.
--   * `grant execute on function public.shared_collection(uuid) to anon` stays exactly as it is.
--     See the note below — it is a function grant, not a table grant, and share links depend on
--     it.
--   * `usage` on schema `public` stays. Revoking that would break the share function call.
--   * Storage bucket and `storage.objects` policies are untouched; nothing here reaches `storage`.
--
-- Why share links keep working. `public.shared_collection(uuid)` is `security definer` and owned
-- by `postgres`, so its body executes with `postgres`'s privileges, not the caller's. An
-- anonymous visitor needs exactly two things to reach a shared collection, and this migration
-- removes neither:
--
--     usage on schema public                         -> anon=U/pg_database_owner
--     execute on public.shared_collection(uuid)      -> anon=X/postgres
--
-- The function then reads `notes` and `collections` as `postgres`. `anon`'s own rights on those
-- tables were never consulted on that path and are not consulted now. Both facts were read off
-- the live project (`pg_namespace.nspacl`, `pg_proc.proacl`) before this file was written.
--
-- Idempotent: `revoke` of a privilege the role does not hold is a no-op, not an error, so this
-- can be replayed. The `to_regclass` guard covers the other direction — a database where one of
-- these tables does not exist yet, which would otherwise raise 42P01 and abort the migration.

do $$
declare
  -- The six user-owned tables, as confirmed against pg_class on the linked project.
  target_tables constant text[] := array[
    'public.collections',
    'public.note_images',
    'public.note_tags',
    'public.notes',
    'public.search_history',
    'public.tags'
  ];
  target text;
begin
  foreach target in array target_tables loop
    if to_regclass(target) is null then
      raise notice 'revoke_anon_table_grants: % does not exist, skipped', target;
    else
      execute format('revoke all privileges on table %s from anon', target);
    end if;
  end loop;
end $$;

-- Note for whoever adds the seventh table.
--
-- This revokes on tables that exist now. It does not change the default privileges, and those
-- still grant the full set to `anon` on every new table in `public`:
--
--     pg_default_acl (objtype 'r', schema public), granted by both postgres and supabase_admin:
--       anon=arwdDxtm
--
-- So a table created after this migration arrives with the grant back. That is the mirror image
-- of `rls_auto_enable()`: RLS is switched on for a new table automatically, the `anon` grant is
-- handed out automatically, and only the first of those two is what this project wants. Closing
-- it in general would mean
--
--     alter default privileges in schema public revoke all on tables from anon;
--
-- run for each granting role. That is a project-wide change affecting objects this app does not
-- own, so it is left as a deliberate decision rather than folded into this migration. Until it is
-- taken, add the new table to the list above.
