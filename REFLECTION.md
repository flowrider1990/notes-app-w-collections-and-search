# REFLECTION

Graded artifact. Every heading below maps to a required or bonus criterion — fill each one, do not
delete unused headings without checking whether they were required.

---

<!-- ==========================================================================
     BEFORE YOU HAND THIS IN — delete this whole block once it is all done.
     Deadline: 21 August 2026. Audited against project-context-and-requirements.md
     on 17 August 2026; the code requirements all pass, these are what is left.
     ========================================================================== -->

## ⚠️ Pre-hand-in checklist

### 1. Rewrite this file in your own voice — the brief asks for it explicitly

> "REFLECTION.md (300–500 words) addressing three issues. **IMPORTANT: ask me, the dev, to fill them
> in manually before the final commit**"

Two long sections below are currently **Claude's words, not yours**: *Persistence decision* and
*Optional task #2 — Full-text search*. Keep them as raw material and rewrite. Also: this file is
**~1,500 words** against a 300–500 word target, so decide whether the grader wants the tight version
or the full one.

### 2. Fill the empty sections

- [ ] **Optional task #1 — Collections and tag-based filtering.** Branch and PR are filled; the body
      is still the template prompt.
- [ ] **Fresh-session diff review.** Entirely empty (PR, finding, resolution). Evaluation criterion 5
      wants "at least one merged pull request … with a fresh-session review noted". The
      `/claude-md-review` section above it covers the *slash-command* topic, not this one.
- [ ] **One sentence on the tags deviation.** The brief says "add a tags column to the notes table";
      this app uses a `tags` table plus a `note_tags` join, which allows a colour per tag and reuse
      across notes. Say so, or it reads as a missed requirement rather than a design decision.

### 3. Add the data explanation — evaluation criterion 4, weight 2

Criterion 4 asks that this file *or the review call* "explains what each relevant column means and
describes how a new row is created when a note is added". Nothing here does that yet. Cover at least:
`notes.id`, `notes.user_id` (defaults to `auth.uid()`, which is why no insert passes it),
`collection_id` (nullable — a note can be uncategorised), `updated_at` (maintained by a database
trigger, so it also moves when you pin or archive), and `search_vector` (a generated `tsvector`, kept
in step by Postgres). Then: clicking **New note** calls a Server Action → `createNote()` in
`lib/db/` → one `insert` with only `collection_id`, everything else from column defaults → RLS checks
`user_id = auth.uid()` on the way in.

### 4. Screenshots — one required, two bonus

- [ ] **Required (criterion 5):** the workspace running locally, signed in, showing the sidebar with a
      collection and coloured tags plus an open note. Save as **`docs/screenshot-workspace.png`** —
      README.md already points at that exact path, so the image renders with no edit.
- [ ] **Bonus — SQL scoping evidence.** Run this in the Supabase **SQL Editor** (the grader wants the
      editor, not the CLI) and screenshot the result. It shows both accounts' rows with distinct
      `user_id`s — 5 for `florian.eisler@gmail.com`, 3 for `abc@test.de`:
      ```sql
      select u.email, n.user_id, n.title, n.created_at
      from public.notes n
      join auth.users u on u.id = n.user_id
      order by u.email, n.created_at;
      ```
- [ ] **Bonus — Authentication → Users tab**, showing the accounts registered during verification.
      Criterion 4 asks you to be able to show this.
- [ ] Attach the workspace shot to a PR and fill in the *Screenshot with collections visible* line
      below.

### 5. Run the auth-flaw scan from the authentication lesson

Requirement 2 says to run it and fix anything it flags before merging. **It is not in this repo** —
`.claude/commands/` holds only `claude-md-review.md`. Source it from the lesson, drop it in
`.claude/commands/`, and it is one call to run against a PR diff.

Worth knowing when you do: the flaw class it looks for — a check that trusts only the browser
session — **was** present and was fixed. `requireUser()` used `getClaims()`, which verifies a token
locally against a cached JWKS without ever asking the Auth server; it now calls `getUser()`. So expect
a clean result, but the requirement is to have run *their* scan.

<!-- ====================== end of pre-hand-in block ====================== -->

---

## Persistence decision

**Chosen: Supabase Postgres, reached through `@supabase/ssr` and confined to `lib/db/`.**
Recorded as an ADR in [`docs/decisions.md`](docs/decisions.md#persistence), which carries the options
considered and the costs accepted; this section is the short version.

Web storage was never a candidate — the brief rules out `localStorage` and `sessionStorage`
outright, and for good reason: neither can be scoped to a user, queried, or read from the server,
so a second account on the same browser would see the first account's notes.

The real choice was between Supabase and standing up a separate database. Supabase won on one
argument above the others: the project already used it for authentication, which means
`auth.uid()` is available inside the database, and that lets Row Level Security enforce ownership
one layer below the application. A query for "my notes" carries no `user_id` filter anywhere in
`lib/db/index.ts` — the database refuses to return anyone else's rows even if the application
forgets to ask correctly. Putting the security boundary under the app instead of inside it is
worth more than any convenience.

Two consequences followed from that and are worth recording:

- **A failed read looks like an empty table.** RLS returns `[]` with `error: null` when no policy
  matches, so "no notes" and "not allowed" are the same response. That is why `requireUser()`
  exists and why every helper checks `error` explicitly — an unauthorised read must never be
  allowed to pass itself off as an empty workspace.
- **Search stayed in the database.** Because the notes already live in Postgres, full-text search
  is a generated `tsvector` column with a GIN index rather than a scan in JavaScript. Under web
  storage that feature would have meant matching substrings over every note in memory.

The alternative — a database of my own plus hand-rolled sign-in — would have meant two systems to
secure and custom password handling, which the project rules forbid outright.

---

## Optional task #1 — Collections and tag-based filtering

**Branch:** `feature/notes-foundation` — the template pre-filled `feat/collections-tags`, which was
never the branch actually used.
**PR:** #2

*What was built, and what was non-obvious about it.*

---

## Optional task #2 — Full-text search across note bodies

**Branch:** `feature/notes-foundation`
**PR:** #2

Search runs in Postgres. `notes.search_vector` is a generated `tsvector` over title and body with a
GIN index behind it, and the sidebar's search box queries it through a Server Action —
`searchNotes()` in `lib/db/index.ts` — so the database returns only the matching rows. Nothing is
filtered in the browser.

**Why not `ilike '%term%'`.** It cannot use an index, so every search reads every row; and it matches
substrings rather than words, so "cat" hits "category". A `tsvector` gives real word matching with
stemming, which is what makes searching "shopping" find a note that says "shop".

Three things were not obvious:

- **Raw user input cannot reach `to_tsquery`.** The characters `& | ! ( ) : * < >` are operators, so a
  lone apostrophe raises Postgres `42601` — a syntax error, not an empty result. Search would break
  on punctuation rather than quietly find nothing. `toTsQuery()` in `lib/search-query.ts` reduces the
  input to alphanumeric tokens instead of escaping character by character, which removes the whole
  class of failure.
- **Full-text search matches whole words, which breaks search-as-you-type.** With the stemmer,
  "shopping" is indexed as "shop", so typing "shopp" finds nothing until the word is complete. The
  last token gets a `:*` prefix marker; the earlier ones are already typed out.
- **The `'english'` config has to be identical on both sides.** The generated column and the query
  both name it. Build the vector with one configuration and query with another and the stems never
  line up, so nothing matches — and there is no error to tell you why.

**Where the line falls.** Text search is server-side; the tag filter is not. The sidebar already
holds the note list in memory to render it, tags come down with each note in the same round trip, and
comparing ids in the client makes a tag toggle instant. Sending a query per tag click would be a
round trip to compute something already on hand. Both facts are worth stating plainly rather than
implying the whole sidebar is server-filtered.

**Evidence.** `explain analyze` of the search predicate reports
`Filter: (search_vector @@ '''test'':*'::tsquery)` with `Rows Removed by Filter: 4` — the database
does the filtering. The planner picks a sequential scan at this table size, which is correct for
seven rows; with `enable_seqscan = off` it switches to
`Bitmap Index Scan on notes_search_vector_idx`, so the index is present and is what it will use once
the table is large enough to matter.

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
