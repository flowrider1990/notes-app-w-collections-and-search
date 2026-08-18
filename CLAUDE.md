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
| `/auth/login`, `/auth/sign-up`, `/auth/sign-up-success` | signed out | Email/password, Google and GitHub sign-in; self-service sign-up. |
| `/auth/forgot-password` | signed out | Asks Supabase to email a reset link. |
| `/auth/update-password` | **signed in** | Sets a new password. Gated with `requireUser()` — the recovery link is what grants the session, and `updateUser` acts on the signed-in user, so an expired link must redirect rather than show a form. |
| `/auth/callback`, `/auth/confirm`, `/auth/error` | signed out | Route handlers for the OAuth code exchange and email links, plus one page to land failures on. |
| `/notes`, `/notes/[id]` | signed in | The workspace. This is the app. |
| `/share/[token]` | anyone | One shared collection, read-only. See "Shared collections". |

Everything a signed-in user needs is in the workspace, including sign-out and the theme switcher,
in the sidebar header in `app/notes/layout.tsx`. There is no global nav and no page that merely
links to another page.

**Do not add pages.** The starter's `/protected` demo page, its tutorial components, its hero and
its deploy button were deleted deliberately — if a route does not help someone read or write a
note, it does not belong.

Password reset was deleted on that reasoning too, then brought back, and the difference is worth
recording: it was pointless while every account was made in the Supabase dashboard, and became
necessary once people could register themselves — a user who signs up can lock themselves out. The
two pages and the link in `components/login-form.tsx` came back out of `b61e013^`.

Where a signed-in user lands is `AFTER_SIGN_IN_PATH` in `lib/auth-redirect.ts`, read by the login
form, the OAuth callback, the sign-up confirmation email and the update-password form. `safeNextPath`
sits beside it: both auth route handlers take a `?next=` from an email or a provider, so both need
the same in-app-path-only guard against an open redirect.

**Email links arrive in two shapes**, and `/auth/confirm` handles both, because which one turns up
depends on the email template configured in the dashboard rather than on anything in this codebase.
The documented templates send a `token_hash`, verified with `verifyOtp`, and work from any device.
The default `{{ .ConfirmationURL }}` template sends a `code`, exchanged with
`exchangeCodeForSession` — and that path needs the PKCE verifier cookie, so the link only works in
the browser that requested it. Opening a reset email on a phone fails until the documented templates
are pasted in. Do not "simplify" the route down to one branch without checking which template the
project is on.

## Stack

- Next.js, **App Router**
- TypeScript
- Tailwind CSS
- Supabase (Postgres) for persistence, via `@supabase/supabase-js` and `@supabase/ssr`

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

The port is pinned to 3000 in the `dev` script, explicitly rather than by relying on Next's default.
It matters more here than in most projects: OAuth and every emailed auth link come back to
`/auth/callback` or `/auth/confirm` on whatever origin the dev server is serving, and that exact
origin has to be in the project's Supabase redirect allow list. A port that drifts is a sign-in that
stops working, with no error that says so.

This used to be 3001, because another local project held 3000. If `npm run dev` fails with
`EADDRINUSE`, that is what has come back — free the port rather than letting this app wander, since
the brief and the README both name 3000.

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
   `updateUser`, `resetPasswordForEmail`, `signOut` — and every one of them is wrapped in
   `lib/db/auth-browser.ts` so no component builds a Supabase client (rule 3). Providers go through
   one `signInWithProvider()`; adding another is a line in its `OAuthProvider` type. The only local logic allowed near a password is
   form validation, like the "passwords match" comparison in `components/sign-up-form.tsx`. Nothing
   may write a password to `localStorage`, `sessionStorage`, a cookie or a log — and note that no
   note data may live in web storage either: Supabase is the only persistence layer in this project.

## Supabase conventions

Six tables: `notes`, `collections`, `tags`, `note_tags`, `search_history`, `note_images` — plus one
Storage bucket, `note-images`.

- `notes` → `collections` is many-to-one via `notes.collection_id`, nullable so a note can be
  uncategorised.
- `notes` ↔ `tags` is many-to-many through the `note_tags` join table.
- Every user-owned table has a `user_id` column defaulting to `auth.uid()`. Inserts do not pass it.
- **RLS is enabled on every table** and every table has owner-scoped policies. A query returning
  `[]` with `error: null` usually means a policy did not match, not that the table is empty — check
  the policy and the signed-in user before debugging the UI.
- **Every write that targets one row by id reads that id back.** It ends with `.select("id")` and
  passes the result to `assertWriteHit()` in `lib/db/index.ts`. This follows from the point above: a
  write to a row the caller cannot see returns zero rows and `error: null`, so without the read-back
  a stale id reports success and changes nothing. Adding such a write without the guard reintroduces
  the most misleading failure this layer can produce.

  Three deletes skip it on purpose, and each says so in place: `removeTagFromNote`,
  `removeSearchHistoryEntry` and `clearSearchHistory`. Removing something already gone is the state
  the caller wanted, so guarding those would turn an impatient double-click into an error about a
  state the user was trying to reach.
- **Tag names are case-folded.** One tag per name per user regardless of case, enforced both by
  `addTagToNote` and by a unique index on `(user_id, lower(name))`. Otherwise "work" and "Work"
  become two pills that look identical, draw the same colour, and filter to disjoint sets of notes.
  `createTag` and `updateTag` both write into that same index, so creating or renaming onto a name
  that already exists in any casing raises `23505` and is reported as a duplicate — it is never a
  silent merge. Recasing a tag's own name is fine, because the only conflicting row is itself.
  `deleteTag` is a real delete of the tag row: `note_tags.tag_id` cascades, so the links go and every
  note keeps its text. Removing a tag *from a note* is a different thing — `removeTagFromNote` drops
  the join row only and the tag stays in the workspace for reuse.
- **The tag palette is ten fixed colours**, listed in `TAG_COLORS` in `lib/tag-colors.ts` and enforced
  by `tags_color_check`. The two lists are not linked by anything but this note: offering a colour the
  constraint does not know fails at runtime as `23514`, which a user only sees as "Could not update
  the tag", so the helpers validate against `TAG_COLORS` before writing. A tag created from a note
  takes a colour hashed from its name; the sidebar's tag manager then lets the user pick any of the
  ten. Class names are spelled out per colour rather than interpolated, because Tailwind only compiles
  literals it can find in the source — and `lib/` is in the content globs for exactly that reason.
- Primary keys are `uuid` defaulting to `gen_random_uuid()`. Timestamps are `timestamptz`.
- `notes.updated_at` is maintained by a database trigger, not by application code. The trigger fires
  on every `UPDATE`, so flipping `pinned` or `archived` bumps it too — do not read it as "last
  edited by hand".
- Full-text search runs in Postgres: `notes.search_vector` is a generated `tsvector` with a GIN index.
  The query string is built by `toTsQuery` in `lib/search-query.ts`, which strips tsquery operators
  out of user input — raw text reaching `to_tsquery` raises `42601` rather than matching nothing. The
  `config` must stay `'english'` on both sides or the stems will not line up and nothing matches.
- **Image attachments live in Storage, never in Postgres.** `note_images` records which note each
  file belongs to; the bytes sit in the private `note-images` bucket under
  `{user_id}/{note_id}/{uuid}.{ext}`. No base64 columns — a photograph in a row would bloat every
  read of that row and bypass the CDN. Because the bucket is private, rendering an attachment needs
  a signed URL minted server-side from the owner's session, so `getNoteImages` returns URLs rather
  than paths and the page mints fresh ones on each visit. Shared collections show title and body
  only: images are the owner's, and `/share/**` must not gain a second anonymous read path.
  Uploads go through a Server Action, not the browser talking to Storage, which keeps the Supabase
  client out of components and makes the upload and its row one call that either works or says why.
  Deleting a note reads the paths, deletes the row, then removes the files: Postgres cascades the
  rows but knows nothing about Storage, and there is no transaction across both. Files-first would
  risk destroying them and then failing to delete the note — irreversible loss — so the order is
  chosen to make the worst case orphaned objects instead. `deleteArchivedNotes` keeps that order for
  the whole archive at once: collect the ids, read their paths, one `delete ... in (ids)`, then one
  `remove`. It returns the deleted count rather than reading a row back — it targets a set, not one
  row by id, so the rule below does not apply and an empty archive is not a failure.
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
