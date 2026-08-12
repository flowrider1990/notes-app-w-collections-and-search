# REFLECTION

Graded artifact. Every heading below maps to a required or bonus criterion — fill each one, do not
delete unused headings without checking whether they were required.

---

## Persistence decision

*Which mechanism, and why. Cross-reference `docs/decisions.md`.*

---

## Optional task #1 — Collections and tag-based filtering

**Branch:** `feature/notes-foundation` — the template pre-filled `feat/collections-tags`, which was
never the branch actually used.
**PR:** #2

*What was built, and what was non-obvious about it.*

---

## Optional task #2 — Full-text search across note bodies

**Branch:**
**PR:**

*Bonus criterion. What was built and why this approach over title-only search.*

---

## Third-party slash command on a PR diff

**Command used:** `/claude-md-review` — a **custom project command** authored for this repo, not a
third-party one. It lives at `.claude/commands/claude-md-review.md` and reviews a PR diff against
this project's own `CLAUDE.md` rules and `docs/schema.sql`, rather than against general code quality.
Named `claude-md-review` because `code-review` collides with a built-in skill.
**PR it ran against:** #2 — *feat(notes): notes workspace with collections, tags and search*
**Run before merge:** yes

### Output

```
PR #2 — feat(notes): notes workspace with collections, tags and search
feature/notes-foundation → main · 20 files · OPEN

RULE 3 — centralised data layer: PASS
  All 11 .from(...) calls live in lib/db/index.ts.
  Both createClient imports: lib/db/index.ts, lib/db/auth.ts — none in a
  component, route handler or Server Action.
  No second query module beside lib/db/index.ts.

ERROR HANDLING: PASS
  11 await-supabase calls, 11 error checks in lib/db/index.ts.
  No component re-checks an error the helper already handled.

SCHEMA TRUTH: PASS
  Every referenced column exists in docs/schema.sql, including tags.color.
  Migration 20260812111118 is idempotent: add column if not exists, and
  add constraint guarded via pg_constraint.
  notes.updated_at is not written by application code (diff line 1256 is a
  type declaration, not a write).

RULE 5 — keys/RLS: PASS   No secret in NEXT_PUBLIC_. No new table.
RULE 1 — App Router: PASS  No pages/.
RULE 2 — dependencies: PASS  package.json untouched.
cacheComponents: PASS  app/notes/[id]/page.tsx:62 passes params as a promise
  into the Suspense child; the await happens at line 18, inside the boundary.
REVALIDATION: PASS  The single call site, actions.ts:26, uses "layout".

FINDING (low) — lib/tag-colors.ts:12-19
  The palette is held twice: TAG_COLORS in TypeScript, and the check
  constraint in docs/schema.sql:28 and the migration. Nothing keeps them in
  step. A seventh colour added to TAG_COLORS without a migration makes
  addTagToNote fail at runtime on 23514, surfacing only as "Could not create
  tag". Fix: cross-reference comments in both directions (present in
  tag-colors.ts, missing in the migration), or read the palette from the
  database instead of duplicating it.

The diff is clean against these rules apart from one low-severity
maintenance risk.
```

### What was done about it

**Acted on:** the single finding, with one adjustment to where. The review suggested the missing
cross-reference belonged in the migration, but that migration is already applied, and editing an
applied migration is exactly the practice this command would flag elsewhere. The `KEEP IN SYNC`
note went into `docs/schema.sql` instead — the documented source of schema truth, and the file a
future author actually reads before writing the next migration. `lib/tag-colors.ts` already pointed
the other way, so the link is now bidirectional.

**Dismissed:** reading the palette from the database instead of duplicating it. That would mean a
query on every render to style a pill, and the constraint already fails loudly on a mismatch. The
duplication is two lines in two files with a comment on each; the query is permanent overhead.

**A near-miss worth recording.** The review almost reported constraint drift: `docs/schema.sql`
declares the check inline and unnamed while the migration names it `tags_color_check`, so a fresh
database seeded from `schema.sql` looked like it would gain a second, duplicate constraint. It does
not — Postgres auto-names a column check `<table>_<column>_check`, which is byte-identical to the
explicit name, so the `pg_constraint` guard matches and skips correctly. Checking that before
writing it up is the difference between a useful review and a wrong one.

**What the command did not catch.** Tag pills rendered with no colour at all, because the Tailwind
`content` globs did not cover `lib/`, where the palette's literal class names live. Tailwind drops
unknown classes silently, so the build stayed green and only a browser showed it. Nothing in a
diff-versus-rules review would surface that — it needed the app running, and it was found by
clicking, not reading. Fixed in `b752fba`.

---

## Fresh-session diff review

**PR reviewed:**
**Reviewed in a new session with no prior context:** yes / no

### Finding

*At least one concrete finding is required. A specific thing a context-free reader caught that the
building session had missed.*

### Resolution

---

## Reset to a previous commit

**Bonus criterion.**

**Commit reset from:**
**Commit reset to:**
**What went wrong in the build step:**
**Why reset rather than fixing forward:**

---

## Screenshot with collections visible

**Bonus criterion.** Attached to PR: _____

---

## What I would do differently

*Not required. Worth two honest sentences anyway.*
