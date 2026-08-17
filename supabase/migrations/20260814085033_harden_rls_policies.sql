-- Hardening pass over the RLS policies, plus one grant cleanup. No schema change:
-- every table keeps the rows it had and the same owner-scoped access.
--
-- Two changes to every policy:
--
-- 1. `to authenticated`. The policies were created without a `to` clause, which
--    means they applied to every role, `anon` included. They still denied an
--    anonymous caller — `auth.uid()` is null for `anon`, so `user_id = auth.uid()`
--    evaluates to null rather than true — but that is a denial by accident of
--    three-valued logic, not a stated rule. Naming the role says what is meant and
--    stops `anon` evaluating the predicate at all.
--
-- 2. `(select auth.uid())` instead of `auth.uid()`. Wrapped in a scalar subquery
--    Postgres evaluates it once per statement; bare, it is re-evaluated for every
--    row scanned. `supabase db advisors` flags all 19 policies for this
--    (`auth_rls_initplan`). Behaviour is identical.
--
-- Share links are unaffected. `/share/**` reads through `public.shared_collection`,
-- a `security definer` function that bypasses RLS entirely, so nothing anonymous
-- depends on these policies matching.
--
-- Idempotent: every policy is dropped by name before it is recreated.

-- ============================================================
-- collections
-- ============================================================

drop policy if exists collections_select on public.collections;
create policy collections_select on public.collections
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists collections_insert on public.collections;
create policy collections_insert on public.collections
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists collections_update on public.collections;
create policy collections_update on public.collections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists collections_delete on public.collections;
create policy collections_delete on public.collections
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- tags
-- ============================================================

drop policy if exists tags_select on public.tags;
create policy tags_select on public.tags
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists tags_insert on public.tags;
create policy tags_insert on public.tags
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists tags_update on public.tags;
create policy tags_update on public.tags
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists tags_delete on public.tags;
create policy tags_delete on public.tags
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- notes
-- ============================================================

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- note_tags — ownership derived from the parent note
-- ============================================================

drop policy if exists note_tags_select on public.note_tags;
create policy note_tags_select on public.note_tags
  for select to authenticated using (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = (select auth.uid())
    )
  );

drop policy if exists note_tags_insert on public.note_tags;
create policy note_tags_insert on public.note_tags
  for insert to authenticated with check (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tags t
      where t.id = note_tags.tag_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists note_tags_delete on public.note_tags;
create policy note_tags_delete on public.note_tags
  for delete to authenticated using (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and n.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- search_history
-- ============================================================
-- The UPDATE policy stays load-bearing: recording a search upserts on
-- (user_id, query), and without it the conflict path is denied and the write
-- silently does nothing.

drop policy if exists search_history_select on public.search_history;
create policy search_history_select on public.search_history
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists search_history_insert on public.search_history;
create policy search_history_insert on public.search_history
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists search_history_update on public.search_history;
create policy search_history_update on public.search_history
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists search_history_delete on public.search_history;
create policy search_history_delete on public.search_history
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- public.rls_auto_enable() — remove the API grant
-- ============================================================
-- An event trigger function that enables RLS on any new table created in `public`,
-- so a table added in a hurry fails closed instead of open. It is not called by the
-- application and is documented in docs/schema.sql.
--
-- Postgres grants `execute` to `public` on every new function, which puts this one
-- on the REST API as `/rest/v1/rpc/rls_auto_enable` for `anon` and `authenticated`
-- — what `supabase db advisors` reports as
-- `anon_security_definer_function_executable`. Calling it over the API fails
-- anyway, because `pg_event_trigger_ddl_commands()` only works inside an event
-- trigger, but a `security definer` function owned by `postgres` has no business
-- being reachable from the internet. Revoking costs nothing: event triggers fire as
-- the owner and do not consult these grants.

revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from public;

-- ============================================================
-- public.set_updated_at() — pin the search path
-- ============================================================
-- The trigger that stamps `notes.updated_at` resolved `now()` through whatever
-- `search_path` was in effect for the caller, which is what `supabase db advisors`
-- reports as `function_search_path_mutable`.
--
-- Nothing was exploitable. `now()` resolves out of `pg_catalog`, which is searched
-- first whether or not it is named, so there is no earlier schema in which to hide a
-- substitute; and the function is `security invoker`, so injected code would run
-- with the caller's own privileges and gain them nothing. Contrast
-- `public.shared_collection`, which is `security definer` and where the same laxness
-- would hand an attacker the owner's privileges — that one has always been pinned.
--
-- Pinned anyway, because the reasoning above depends on the body staying this
-- trivial. `search_path = ''` forces every future reference in it to be
-- schema-qualified rather than resolved at the caller's discretion.
--
-- `alter function` rather than `create or replace`: the body does not change, and
-- rewriting it would silently reformat what section 3 of docs/schema.sql documents.

alter function public.set_updated_at() set search_path = '';
