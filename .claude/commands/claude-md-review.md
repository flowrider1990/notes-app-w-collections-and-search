---
description: Review a PR diff against this project's CLAUDE.md rules and docs/schema.sql
argument-hint: <pr-number>
allowed-tools: Bash(gh pr diff:*), Bash(gh pr view:*), Read, Grep, Glob
---

# Review PR #$1 against this project's own rules

Review the diff of PR **#$1** against the rules this repository sets for itself. This is not a
general code review: judge the diff only against the project's documented conventions and its real
schema. A separate `/code-review` covers correctness.

## Gather

1. `gh pr view $1 --json title,headRefName,baseRefName,state`
2. `gh pr diff $1` — the diff under review
3. Read `CLAUDE.md` — the rules are stated there and may have changed; do not work from memory
4. Read `docs/schema.sql` — the current-state reference for tables and columns
5. `ls supabase/migrations/` — a schema change should have a migration alongside it

Review only what the diff touches. Pre-existing violations elsewhere in the repo are out of scope —
saying "the scaffold's auth components also do this" is useful context in one line, never a finding.

## Check for

**Data layer — CLAUDE.md rule 3.** All database access goes through `lib/db/`.

- a Supabase client imported outside `lib/` — `@/lib/supabase/server`, `@/lib/supabase/client`,
  `createServerClient`, `createBrowserClient`
- a `.from(...)` query written in a component, a route handler, or a Server Action body instead of
  being added to `lib/db/` and called
- a second query module appearing beside `lib/db/index.ts`, which is meant to be the single one

Match real `import` statements, not mentions in comments or docstrings. A file that merely names a
path in prose is not importing it — check the line before reporting it.

**Error handling.** `supabase-js` returns `{ data, error }` and does not throw. Every call must
check `error`, once, inside the helper module. Flag a destructured `data` whose `error` is ignored,
and flag a component that re-checks an error the helper already handled.

**Schema truth.** Every table and column the diff references must exist in `docs/schema.sql`.

- a column that does not exist, or a typo'd name
- a schema change with no matching file in `supabase/migrations/`
- a migration that is not idempotent: bare `add column` without `if not exists`, or
  `add constraint` without a `pg_constraint` guard, which has no `if not exists` clause
- application code writing `notes.updated_at` — a database trigger owns it

**RLS and keys — CLAUDE.md rule 5.**

- the service-role or any secret key in a `NEXT_PUBLIC_` variable, or reaching client code
- a query filtering by `user_id` by hand where RLS already scopes it, which suggests a
  misunderstanding worth a note rather than a defect
- a new table without `enable row level security` and owner-scoped policies

**App Router — rule 1.** A `pages/` directory appearing is a bug.

**Dependencies — rule 2.** Any addition to `package.json`, including devDependencies, needed to be
asked about first. Report it as a finding even if the package seems obviously fine.

**Rendering constraints.** `next.config.ts` sets `cacheComponents: true`, so `cookies()`,
`headers()`, `params` or `searchParams` read outside a `<Suspense>` boundary fails the build. Flag
any new route that unwraps `params` in the page body rather than passing the promise into a child
inside the boundary.

**Revalidation.** Workspace data is fetched in `app/notes/layout.tsx`. A mutation that revalidates
with the default `"page"` type leaves the sidebar stale — it needs `revalidatePath("/notes", "layout")`.

## Report

For each finding: `file:line`, the rule it breaks, and what to do instead. Order by severity —
things that break at runtime or leak a secret first, conventions after. Keep each to two or three
sentences.

Then state, in one line, whether the diff is clean against these rules.

**Do not invent findings.** If the diff is clean, say so plainly and stop. Filler findings make the
review worthless. Equally, do not soften a real one: a leaked key or a bypassed data layer is a
finding regardless of how small the diff is.

If a check does not apply — no migrations touched, no dependencies changed — omit it silently rather
than reporting "no issues found" for each one.
