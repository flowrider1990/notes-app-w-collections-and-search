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
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. There is no deployment step and no
public URL.

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
5. **Only the anon key belongs in client-side environment variables.** If something needs the
   service role key to work, the RLS policy is wrong — fix the policy.

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
- Schema changes are made in the Supabase dashboard SQL editor. Write the SQL into
  `docs/schema.sql` and ask the user to run it — you cannot click in the dashboard.

## Error handling

`supabase-js` returns `{ data, error }` and does not throw. Every call must check `error`. Handle it
once inside the helper module rather than in each component.
