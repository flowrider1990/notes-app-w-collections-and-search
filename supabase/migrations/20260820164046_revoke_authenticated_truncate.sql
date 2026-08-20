-- Take TRUNCATE away from `authenticated` on the six user tables.
--
-- 20260820152052_revoke_anon_table_grants.sql made this exact argument and then applied it to
-- `anon` only:
--
--     "TRUNCATE is not filtered by RLS, because policies are evaluated per row and TRUNCATE
--      removes rows without visiting them. For that one command the grant is the only control."
--
-- The reasoning does not stop at `anon`. `authenticated` is the role every signed-in browser
-- session assumes, and it holds `arwdDxtm` on all six tables -- read live before this file was
-- written:
--
--     public.{collections,note_images,note_tags,notes,search_history,tags}
--       -> {postgres=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--
-- The `D` is TRUNCATE. RLS does not constrain it, so the grant is what stands between a signed-in
-- user and every other user's notes -- a `truncate public.notes` deletes the table, not their rows.
--
-- Not reachable today, which is why the audit filed it Medium rather than High: PostgREST has no
-- TRUNCATE verb, so nothing in the current app can issue one. What the grant costs is that the
-- safety of the six tables depends on that staying true. Any future `security invoker` RPC, or any
-- helper that builds SQL from input, becomes a total-data-loss bug instead of a row-scoped one.
-- Revoking it makes RLS the whole story: the policies in section 4 gate SELECT, INSERT, UPDATE and
-- DELETE, and TRUNCATE was the one command reaching these tables that they could not gate.
--
-- Deliberately narrow:
--
--   * TRUNCATE only. SELECT, INSERT, UPDATE and DELETE are how the app works and are untouched --
--     every one of them is filtered by the policies in docs/schema.sql section 4. REFERENCES and
--     TRIGGER are left alone too; neither is a data-reachability question and neither is what the
--     audit found.
--   * `authenticated` only. `anon` already holds nothing after 20260820152052 and is not named
--     here. `service_role` and `postgres` keep everything: trusted server-side roles, never in a
--     browser (CLAUDE.md rule 5).
--   * No policy is created, dropped or altered. No RLS flag is changed. Nothing here reaches
--     `storage` -- not its buckets, not its object policies.
--   * The default privileges from 20260820154942 are not revisited, and that is a real limit
--     rather than a tidy one. That migration kept `authenticated`'s table defaults on the grounds
--     that every table here is meant to be reachable by a signed-in user and gated by RLS -- which
--     is the argument this file refutes for TRUNCATE specifically. So the template still stamps
--     TRUNCATE onto a seventh table, and closing it permanently would take one more statement:
--
--         alter default privileges for role postgres in schema public
--           revoke truncate on tables from authenticated;
--
--     That is deliberately not done here: this migration was scoped to the six tables the audit
--     named. Until it is, a new table needs a line adding to this list by hand -- unlike the `anon`
--     side, which section 9 closed at the template.
--
-- Idempotent: revoking a privilege a role does not hold is a no-op, so this replays cleanly. It
-- does assume the six tables exist, unguarded, the way 20260820163152 assumes its function does.
-- They all do by the time it runs -- four are created by docs/schema.sql, `search_history` by
-- 20260812130200 and `note_images` by 20260817145538.

revoke truncate on table public.collections    from authenticated;
revoke truncate on table public.note_images    from authenticated;
revoke truncate on table public.note_tags      from authenticated;
revoke truncate on table public.notes          from authenticated;
revoke truncate on table public.search_history from authenticated;
revoke truncate on table public.tags           from authenticated;
