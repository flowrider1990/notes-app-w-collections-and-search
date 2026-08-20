-- Close the default privileges that hand `anon` and `authenticated` rights on every object
-- created later in schema `public`.
--
-- 20260820152052_revoke_anon_table_grants.sql revoked the `anon` table grant on the six tables
-- that existed when it ran, and closed by naming this migration as the outstanding work: the
-- defaults were left alone, so a seventh table would arrive with the grant restored. This is
-- that follow-up, widened to cover functions as well as tables.
--
-- The functions half is the more urgent of the two, and it is not documented anywhere in this
-- repo. Read off the linked project before this file was written:
--
--     pg_default_acl, schema public, objtype 'f', granted by postgres AND by supabase_admin:
--       {postgres=X, anon=X, authenticated=X, service_role=X}
--     pg_default_acl, schema public, objtype 'r', granted by postgres AND by supabase_admin:
--       {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
--
-- `create function` in `public` therefore produces an unauthenticated REST endpoint at
-- /rest/v1/rpc/<name> with no `grant` written anywhere. That is a bad default for any project;
-- it is a worse one here, because CLAUDE.md steers contributors directly at it: "Do not add anon
-- policies to any table; extend the function instead." The next `security definer` helper written
-- to that instruction is callable by a stranger unless its author remembers to revoke -- and it
-- executes as its owner with RLS bypassed. The project has already paid this bill once:
-- 20260814085000_add_rls_auto_enable.sql:94-96 exists only to take back the execute that
-- `create function` handed out for free.
--
-- After this migration a new function is reachable only once someone writes an explicit
-- `grant execute`, the way `shared_collection` does. Closed by default, opened deliberately.
--
-- What this changes: nothing that exists today.
--
-- ALTER DEFAULT PRIVILEGES is prospective only. It rewrites the template consulted at CREATE
-- time and never touches an object already created, so every current ACL is left exactly as it
-- is. Verified against the live project before writing:
--
--   * public.shared_collection(uuid) -> {postgres=X, anon=X, authenticated=X, service_role=X}
--     Those are explicit grants, written by schema.sql section 6. Share links keep working.
--   * public.rls_auto_enable()       -> {postgres=X, service_role=X}
--     anon and authenticated already absent. Still absent.
--   * The six tables keep every `authenticated` grant they hold. Only the template changes,
--     and only for `anon`.
--
-- No RLS policy is touched. Nothing here reaches `storage` -- not its buckets, not its object
-- policies. `usage` on schema `public` is untouched, which matters because the share function
-- call needs it.
--
-- `service_role` keeps its defaults. It is the trusted server-side key and is never exposed to
-- a browser (CLAUDE.md rule 5); removing its defaults would break future admin tooling for no
-- security gain.
--
-- Table defaults are revoked from `anon` only. `authenticated` keeps its table defaults, because
-- every table in this project is meant to be reachable by a signed-in user and gated by RLS --
-- that is the whole design. `anon` is different: it holds no policy on any user table and is
-- meant to reach the database through exactly one door, `shared_collection`.
--
-- Idempotent: revoking a default privilege the role does not hold is a no-op, so this replays
-- cleanly.


-- ------------------------------------------------------------------------------------------
-- Part 1 of 2 -- role `postgres`. Mandatory.
-- ------------------------------------------------------------------------------------------
--
-- A default ACL is keyed to the role that CREATES the object, not to whoever runs this file.
-- `postgres` is the role that creates everything this project owns, because that is the role
-- `supabase db push` connects as. This row is therefore the one that governs the tables and
-- functions in this repository, and closing it is the entire point of the migration.
--
-- Deliberately unguarded: no existence check, no exception handler, no dynamic SQL. If either
-- statement fails for any reason the migration aborts and the failure is visible. A silent skip
-- here would be worse than useless -- it would leave the hole open while the migration history
-- claims it was closed.

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;


-- ------------------------------------------------------------------------------------------
-- Part 2 of 2 -- role `supabase_admin`. Attempted only when permitted.
-- ------------------------------------------------------------------------------------------
--
-- KNOWN LIMITATION, and the reason this half is shaped differently from Part 1.
--
-- `supabase_admin` owns the second set of default ACLs on schema `public`. Altering another
-- role's defaults requires privileges over that role: membership in PostgreSQL 15 and earlier,
-- and ADMIN OPTION on it since PostgreSQL 16 (this project is on 17.6). On a hosted Supabase
-- project the migration role `postgres` is not a superuser and holds neither -- read live before
-- this file was written:
--
--     pg_has_role('postgres', 'supabase_admin', 'MEMBER') = false
--     (select rolsuper from pg_roles where rolname = 'postgres') = false
--
-- So under `supabase db push` this half cannot be applied, and no amount of SQL in this file
-- changes that. It is written out rather than omitted so the file is complete and correct on a
-- database where the running role does have the privilege -- a local stack, a self-hosted
-- instance, or a support-assisted session.
--
-- What remains open when it is skipped is narrow. Default ACLs key off the creating role, so the
-- `supabase_admin` row governs objects created BY `supabase_admin`: extensions and
-- Supabase-managed schema. It does not govern anything in this repository. Every table, function
-- and trigger in `docs/schema.sql` is created by `postgres` and is covered by Part 1, which is
-- mandatory and has already run by the time this block is reached.
--
-- The permission test below is a pre-check, not the only line of defence. It approximates a rule
-- whose wording has changed across major versions, so the attempt is still wrapped -- but the
-- handler catches `insufficient_privilege` and nothing else. Any other failure (a syntax error,
-- a role dropped mid-statement, a lock timeout) propagates and aborts the migration, exactly as
-- in Part 1. This block must never turn a real error into a warning.

do $$
declare
  can_alter boolean;
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise notice
      'close_public_default_privileges: role supabase_admin does not exist; nothing to do. '
      'The postgres defaults, which govern the objects this project creates, were hardened '
      'above.';
    return;
  end if;

  -- Superuser, or ADMIN OPTION on supabase_admin held directly or through an inherited role.
  select coalesce((select r.rolsuper from pg_roles r where r.rolname = current_user), false)
      or exists (
           select 1
             from pg_auth_members m
             join pg_roles t on t.oid = m.roleid
            where t.rolname = 'supabase_admin'
              and m.admin_option
              and pg_has_role(current_user, m.member, 'USAGE')
         )
    into can_alter;

  if not can_alter then
    raise warning
      'close_public_default_privileges: role % cannot alter default privileges for '
      'supabase_admin (needs ADMIN OPTION on it, or superuser). DONE: the postgres default '
      'privileges were hardened -- anon and authenticated no longer receive EXECUTE on new '
      'functions in public, and anon no longer receives anything on new tables. Those are the '
      'defaults that govern every table and function this project creates, so the application '
      'is covered. NOT DONE: the supabase_admin default privileges are unchanged and still '
      'grant anon and authenticated. Those apply only to objects created BY supabase_admin -- '
      'extensions and Supabase-managed schema -- and to nothing in this repository. To close '
      'them too, run this migration as a role holding ADMIN OPTION on supabase_admin.',
      current_user;
    return;
  end if;

  begin
    alter default privileges for role supabase_admin in schema public
      revoke execute on functions from anon, authenticated;

    alter default privileges for role supabase_admin in schema public
      revoke all on tables from anon;

    raise notice
      'close_public_default_privileges: supabase_admin default privileges closed as well.';

  exception
    when insufficient_privilege then
      -- Only this condition. Every other error propagates and aborts the migration.
      raise warning
        'close_public_default_privileges: the pre-check passed but the server refused the ALTER '
        'for supabase_admin (insufficient_privilege). DONE: the postgres defaults, which govern '
        'the tables and functions this project creates, were hardened above. NOT DONE: the '
        'supabase_admin defaults, which cover Supabase-managed and extension-created objects '
        'only, remain unchanged.';
  end;
end $$;
