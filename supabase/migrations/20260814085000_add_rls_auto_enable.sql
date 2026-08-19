-- S3 — put `public.rls_auto_enable()` and its event trigger into the migration history.
--
-- The function is the safety net under every RLS policy in this project: an event
-- trigger that enables row level security on any table created in `public`, so a table
-- added without policies fails closed (no rows to anyone) rather than open. It predates
-- these migrations and existed only in the live database and in `docs/schema.sql`.
--
-- What this file fixes is one specific ordering gap.
-- `20260814085033_harden_rls_policies.sql` runs
--
--     revoke execute on function public.rls_auto_enable() from anon, authenticated;
--
-- against a function that no migration created, so that statement had nothing to revoke
-- on and would raise 42883 on any database where the function was not already present.
-- Hence the timestamp: this migration is dated 33 seconds *before* the harden migration,
-- so the function exists by the time that revoke runs. It is a new file, not an edit to
-- an old one; applying it to a database that already has these objects is a no-op, so
-- ordering is the only thing the earlier date changes.
--
-- It does **not** make `supabase/migrations` self-sufficient, and nothing here should be
-- read as claiming that. The base tables — `notes`, `collections`, `tags`, `note_tags`
-- — and `public.set_updated_at()` are created by `docs/schema.sql`, which README.md
-- names as step 1 of Supabase setup. Migrations carry incremental changes on top of that
-- bootstrap; a migrations-only run against an empty database still fails, and at the
-- first file, long before this one.
--
-- Deploying this file to a project that already has `20260814085033` applied needs
--
--     npx supabase db push --linked --include-all
--
-- because it sorts before a migration that is already recorded there.
--
-- Every statement here is idempotent: `create or replace` for the function, and a
-- `pg_event_trigger` guard for the trigger, which has no `if not exists` clause.

-- ============================================================
-- 1. The function
-- ============================================================
-- Copied verbatim from `pg_get_functiondef()` on the linked project rather than
-- retyped, so that applying this to the live database replaces the definition with
-- exactly what is already there. `docs/schema.sql` carried a simplified paraphrase of
-- this body — it is corrected in the same change that adds this file.
--
-- `security definer` is required: the trigger has to alter tables it does not own.
-- `search_path` is pinned to `pg_catalog` so nothing in a caller's path can be
-- resolved ahead of the built-ins it uses.

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- ============================================================
-- 2. Privileges
-- ============================================================
-- `create function` grants execute to PUBLIC, which puts a `security definer`
-- function owned by `postgres` on the REST API for `anon` at
-- `/rest/v1/rpc/rls_auto_enable` — reported by `supabase db advisors` as
-- `anon_security_definer_function_executable`. Calling it that way fails anyway,
-- because `pg_event_trigger_ddl_commands()` only works inside an event trigger, but a
-- reachable endpoint is worth closing regardless. Event triggers fire as the owner and
-- never consult these grants, so revoking costs nothing.
--
-- The harden migration repeats these two revokes. They are stated here as well so the
-- object is correct on its own, and so the end state does not depend on a later file.
-- The `service_role` grant is what the live project carries; it is restated because a
-- fresh database would otherwise end up with `postgres` alone.

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;

-- ============================================================
-- 3. The event trigger
-- ============================================================
-- `create event trigger` has no `if not exists`, so it is guarded — and the guard checks
-- the trigger's shape, not just its name. `ensure_rls` is the name the object carries in
-- the live project, and the tag filter matches what is live: without it the function
-- would be invoked for every DDL command and filter in PL/pgSQL instead of in the
-- trigger definition.
--
-- Note for a rebuild onto a fresh project: creating an event trigger needs rights the
-- `postgres` role does not have everywhere. If this raises `insufficient_privilege`,
-- the function above is still in place and the trigger has to be created by a role
-- that has them — the rebuild should stop rather than continue without the safety net.

do $$
declare
  expected_tags constant text[] := array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'];
  trg record;
begin
  select e.evtenabled, e.evtevent, e.evttags, p.proname, n.nspname
    into trg
    from pg_event_trigger e
    join pg_proc p on p.oid = e.evtfoid
    join pg_namespace n on n.oid = p.pronamespace
   where e.evtname = 'ensure_rls';

  if not found then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();

  -- A trigger of the right name is not the same as the right trigger. One that is
  -- disabled, bound to some other function, listening on another event, or filtering on
  -- different tags satisfies a name check while the safety net is off, and a migration
  -- that only checked the name would report success. Accept a match; refuse anything
  -- else rather than skip past it.
  elsif trg.evtenabled not in ('O', 'A')
     or trg.nspname <> 'public'
     or trg.proname <> 'rls_auto_enable'
     or trg.evtevent <> 'ddl_command_end'
     -- Compared both ways round, so the test is on the set and not on the stored order.
     or not (trg.evttags @> expected_tags and trg.evttags <@ expected_tags)
  then
    raise exception
      'event trigger ensure_rls exists but does not match the RLS safety net: '
      'enabled=%, event=%, function=%.%, tags=%. Expected an enabled ddl_command_end '
      'trigger on public.rls_auto_enable() with tags %. Drop or repair it, then re-run.',
      trg.evtenabled, trg.evtevent, trg.nspname, trg.proname, trg.evttags, expected_tags;
  end if;
end $$;
