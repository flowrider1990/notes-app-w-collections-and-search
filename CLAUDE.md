# CLAUDE.md

## What this is

A personal, single-user notes workspace in the browser. Two panes: a sidebar listing notes
(grouped by collection, filterable by tag and by title search) and an editor with a title field
and a Markdown body that toggles between edit and formatted preview.

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

## Supabase conventions

Four tables: `notes`, `collections`, `tags`, `note_tags`.

- `notes` → `collections` is many-to-one via `notes.collection_id`, nullable so a note can be
  uncategorised.
- `notes` ↔ `tags` is many-to-many through the `note_tags` join table.
- Every user-owned table has a `user_id` column defaulting to `auth.uid()`. Inserts do not pass it.
- **RLS is enabled on every table** and every table has owner-scoped policies. A query returning
  `[]` with `error: null` usually means a policy did not match, not that the table is empty — check
  the policy and the signed-in user before debugging the UI.
- Primary keys are `uuid` defaulting to `gen_random_uuid()`. Timestamps are `timestamptz`.
- `notes.updated_at` is maintained by a database trigger, not by application code.
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
