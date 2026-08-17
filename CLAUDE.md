# CLAUDE.md

## What this is

A personal, single-user notes workspace in the browser. Two panes: a sidebar listing notes
(grouped by collection, filterable by tag and by full-text search) and an editor with a title
field and a body, saved by an explicit Save button.

The body is **plain text**. Markdown rendering with an edit/preview toggle is a possible later
task, not something that exists — it needs a rendering library, which is rule 2's territory. Do
not write code or docs that assume it is there.

A note can be exported as a `.md` file from the editor's action row. That is a download, not a
renderer: `lib/markdown-export.ts` turns the note into `# Title` plus the body verbatim, and the
button saves any pending edit first so the file matches what the database holds. A failed save
cancels the download.

Single-user with one deliberate exception: a collection can be shared by link, and that link is
readable without signing in. See "Shared collections" below — it is the only anonymous read path in
the app.

## Structure

Three things a user can be doing, and nothing else:

| Route | Who | What |
| --- | --- | --- |
| `/` | signed out | Landing page: what the app is, and a Sign in button. Reads no cookies, so it stays static. A signed-in visitor is redirected to `/notes` by `lib/supabase/proxy.ts`. |
| `/auth/login`, `/auth/sign-up`, `/auth/sign-up-success` | signed out | Email/password and Google sign-in; self-service sign-up. |
| `/auth/callback`, `/auth/confirm`, `/auth/error` | signed out | Route handlers for the OAuth code exchange and email confirmation, plus one page to land failures on. |
| `/notes`, `/notes/[id]` | signed in | The workspace. This is the app. |
| `/share/[token]` | anyone | One shared collection, read-only. See "Shared collections". |

Everything a signed-in user needs is in the workspace, including sign-out and the theme switcher,
in the sidebar header in `app/notes/layout.tsx`. There is no global nav and no page that merely
links to another page.

**Do not add pages.** The starter's `/protected` demo page, its tutorial components, its hero and
its deploy button were deleted deliberately — if a route does not help someone read or write a
note, it does not belong. Password reset (`/auth/forgot-password`, `/auth/update-password`) was
removed for the same reason: accounts are made in the Supabase dashboard, so the flow was reachable
but pointless. Restoring it means restoring both pages and the link in `components/login-form.tsx`.

Where a signed-in user lands is `AFTER_SIGN_IN_PATH` in `lib/auth-redirect.ts`, read by the login
form, the OAuth callback and the sign-up confirmation email. Change it in that one place.

## Stack

- Next.js, **App Router**
- TypeScript
- Tailwind CSS
- Supabase (Postgres) for persistence, via `@supabase/supabase-js` and `@supabase/ssr`

## Running it

```bash
npm install
npm run dev          # http://localhost:3001
```

The port is pinned to 3001 in the `dev` script because another application owns 3000 on this
machine. Keep it pinned: Google sign-in returns to `/auth/callback` on whatever origin the dev
server is serving, and that exact origin has to be in the project's redirect allow list. A port
that drifts is a sign-in that stops working.

`.env.local` must exist before the dev server starts or the app throws on boot. It needs
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the newer key name, whose
value starts with `sb_publishable_` rather than being a legacy `eyJ…` anon JWT. There is no
deployment step and no public URL.

The Supabase CLI does **not** read `.env.local`; that file is a Next.js convention. The CLI takes its
credentials from its own store (`supabase login`) or from `SUPABASE_ACCESS_TOKEN` in the process
environment.

For a programmatic correctness check use `npm run build` — it terminates and surfaces type and lint
errors. Do **not** run `npm run dev` in a tool call; it never exits and will hang.

## Rules

1. **Use the App Router, not the Pages Router.** If a `pages/` directory appears, that is a bug.
2. **Do not add libraries without asking first**, including dev dependencies.
3. **All database access goes through `lib/db/` — the centralised helper module.** No component
   imports the Supabase client and no component contains a query. If a component needs data, add a
   function to the helper module and call that.
4. **Never commit `.env.local`.** Run `git check-ignore -v .env.local` before committing; if it
   prints nothing, stop and fix `.gitignore`.
5. **Only the publishable key belongs in client-side environment variables.** If something needs the
   secret or service role key to work, the RLS policy is wrong — fix the policy. A personal access
   token (`sbp_…`) is account-wide, not project-scoped, and belongs in neither `.env.local` nor any
   `NEXT_PUBLIC_` variable — a `NEXT_PUBLIC_` prefix would inline it into the browser bundle.
6. **Every signed-in-only page verifies the session with the Supabase Auth server before it loads,
   and redirects to `/auth/login` when there is no user.** Ask the server with
   `supabase.auth.getUser()` and act on its answer. A browser-side session is not evidence: the
   session lives in cookies the client controls, so a decoded token says only what the sender chose
   to put in it. Notes on what does *not* satisfy this rule:
   - `getSession()` reads storage and verifies nothing.
   - `getClaims()` is not enough either, despite checking the signature. With asymmetric signing keys
     it verifies locally against a cached JWKS and never asks the Auth server, so a session that was
     signed out or revoked still passes until the token expires.
   - The redirect in `lib/supabase/proxy.ts` does not count. Keep it — it saves a pointless render —
     but it is a convenience, not the gate: it runs before the route and can be bypassed, and a page
     that trusts it has no check of its own.

   Implement it in one place: `requireUser()` in `lib/db/auth.ts`. Call it at the top of the page or
   layout that needs the session, and let it redirect. The only pages exempt are `/share/**`, which
   are anonymous by design — see "Shared collections" below.

   Server Actions need the same call. An action is a POST endpoint that the page gate does not
   cover, so every action in `app/notes/actions.ts` opens with `await requireUser()` — placed
   **before** the `try`, never inside it. `requireUser()` redirects by throwing, and those `catch`
   blocks turn a throw into `{ error }`; catching the redirect would report `NEXT_REDIRECT` to the
   user as a save failure.
7. **Supabase Auth owns sign-in and session handling, and the app does no password handling of its
   own.** No password column, no hashing, no salting, no credential storage, and no session
   invented in application code. Signing in, signing out, session refresh, email confirmation and
   password reset are all `supabase.auth.*` calls — `signInWithPassword`, `signInWithOAuth`,
   `updateUser`, `resetPasswordForEmail`, `signOut`. The only local logic allowed near a password is
   form validation, like the "passwords match" comparison in `components/sign-up-form.tsx`. Nothing
   may write a password to `localStorage`, `sessionStorage`, a cookie or a log — and note that no
   note data may live in web storage either: Supabase is the only persistence layer in this project.

## Supabase conventions

Five tables: `notes`, `collections`, `tags`, `note_tags`, `search_history`.

- `notes` → `collections` is many-to-one via `notes.collection_id`, nullable so a note can be
  uncategorised.
- `notes` ↔ `tags` is many-to-many through the `note_tags` join table.
- Every user-owned table has a `user_id` column defaulting to `auth.uid()`. Inserts do not pass it.
- **RLS is enabled on every table** and every table has owner-scoped policies. A query returning
  `[]` with `error: null` usually means a policy did not match, not that the table is empty — check
  the policy and the signed-in user before debugging the UI.
- Primary keys are `uuid` defaulting to `gen_random_uuid()`. Timestamps are `timestamptz`.
- `notes.updated_at` is maintained by a database trigger, not by application code. The trigger fires
  on every `UPDATE`, so flipping `pinned` or `archived` bumps it too — do not read it as "last
  edited by hand".
- Full-text search runs in Postgres: `notes.search_vector` is a generated `tsvector` with a GIN index.
  The query string is built by `toTsQuery` in `lib/search-query.ts`, which strips tsquery operators
  out of user input — raw text reaching `to_tsquery` raises `42601` rather than matching nothing. The
  `config` must stay `'english'` on both sides or the stems will not line up and nothing matches.
- **Shared collections are the one sanctioned RLS bypass.** `collections.share_token` plus the
  `security definer` function `public.shared_collection(token uuid)`, granted to `anon`, is how a
  share link is read without a session. This does *not* contradict rule 5: no secret or service-role
  key is involved. It is a function rather than an anon policy on purpose — a policy permissive
  enough to serve the link would also let a stranger select every shared collection and read the
  tokens out of the table. The function is hardened with `set search_path = ''` and every reference
  schema-qualified. Do not add anon policies to any table; extend the function instead.
- `/share/**` is exempt from the auth redirect in `lib/supabase/proxy.ts`. That exemption is what
  makes share links work at all — do not "tidy" it away.
- Schema changes go through a CLI migration: `npx supabase migration new <name>`, write the SQL,
  then `npx supabase db push --linked`. Mirror the change into `docs/schema.sql`, which stays the
  current-state reference for the whole schema. Write migrations idempotently — `add column if not
  exists`, and guard `add constraint` with a `pg_constraint` check, since it has no such clause.
- The dashboard SQL editor is the fallback when the CLI is unavailable. In that case write the SQL
  into `docs/schema.sql` and ask the user to run it — you cannot click in the dashboard.
- `supabase db dump` and `db diff` need Docker, which is not installed here. For read-only
  inspection use `npx supabase inspect db table-stats --linked`, which connects directly.

## Error handling

`supabase-js` returns `{ data, error }` and does not throw. Every call must check `error`. Handle it
once inside the helper module rather than in each component.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
