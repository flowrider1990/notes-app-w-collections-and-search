# REFLECTION

The three required prompts, in order — just under 500 words. Everything after them is reference material
and is not part of that count.

## 1. The persistent-storage consultation

The brief settled this before I could deliberate. Supabase was the required stack and `localStorage`
and `sessionStorage` were ruled out in the same breath, so I want to be straight about it: I did not
weigh options and pick one. There was no decision to make.

What I did ask Claude Code was the more useful question — not *which* store, but what this one costs
me. That conversation is recorded as an ADR in [`docs/decisions.md`](docs/decisions.md#persistence),
and two things came out of it that I would not have predicted.

First, because Supabase also handles authentication, `auth.uid()` is available *inside* Postgres. That
lets Row Level Security enforce ownership one layer below my own code: no query in `lib/db/` filters
by user, and the database still refuses to return anyone else's rows. The security boundary sits under
the app rather than inside it.

Second, that has a sharp edge. When no policy matches, RLS returns an empty array with `error: null` —
so "not allowed" and "nothing here" are the same response. That is why every helper checks `error`
explicitly and why writes read their own row back: otherwise a write to a row I cannot see reports
success and changes nothing.

## 2. An authentication issue I caught and fixed

`requireUser()` originally called `supabase.auth.getClaims()`. I had assumed that verifying a token's
signature was the same as verifying a session. It is not. With asymmetric signing keys, `getClaims()`
checks the token locally against a cached JWKS and never asks the Auth server — so a session that had
been signed out or revoked kept passing until the token expired. I expected revocation to take effect
immediately; it didn't. Switching to `getUser()`, which asks Supabase, fixed it.

The same review found a second hole I had not considered at all: my Server Actions had no session
check of their own, only the page gate above them. A Server Action is a POST endpoint that gate never
covers. Every action in `app/notes/actions.ts` now opens with `await requireUser()` — placed *before*
the `try`, because `requireUser()` redirects by throwing and a `catch` would have reported
`NEXT_REDIRECT` to the user as a failed save.

## 3. A prompt the agent misinterpreted

I asked for "an option to edit and delete tags". What came back worked, but it was smaller than what I
meant: a pencil and a bin revealed on hover over the existing filter pills, no way to create a tag
without a note to attach it to, and only the six colours the app already had.

I re-prompted with the scope spelled out — "an area where we can manage the app's tags: create new
ones, rename, change the colour from a range of 10 colours, delete" — and that produced the tag
manager in the sidebar plus a migration widening the palette to ten. The fault was mine rather than
the agent's: "edit and delete" named two operations when what I actually wanted was a *place*. Naming
the surface, not just the verbs, would have got it right the first time.

---

# Reference

Not part of the word count.

## Evidence

Three screenshots in [`docs/`](docs), taken 18 August 2026:

- **[`screenshot-workspace.png`](docs/screenshot-workspace.png)** — the workspace running locally,
  signed in: two collections with notes, the "coding" tag in its palette colour, the tag manager open,
  and a note open in the editor with its collection, tags, image slot, Save and Export .md. This is the
  one README.md embeds.
- **[`screenshot-test-accounts.png`](docs/screenshot-test-accounts.png)** — Supabase
  **Authentication → Users**: four accounts with their UIDs, and `florian.eisler@gmail.com` showing
  **GitHub and Google** linked to one identity, which is the social-login task in one frame.
- **[`screenshot_user.png`](docs/screenshot_user.png)** — the SQL Editor scoping query below.

The two dashboard shots are worth reading together: the UIDs in the Users tab are the same values the
`user_id` columns carry, which is what ties "these accounts exist" to "these rows belong to them".

### The scoping query

```sql
select u.email,
       count(distinct n.id) as notes,
       count(distinct t.id) as tags
from auth.users u
left join public.notes n on n.user_id = u.id
left join public.tags  t on t.user_id = u.id
group by u.email
order by notes desc, u.email;
```

It returned `florian.eisler@gmail.com` 5 notes / 2 tags, `abc@test.de` 3 / 4,
`florian.eisler+2@gmail.com` 1 / 2, `florian.eisler+1@gmail.com` 0 / 0.

**Why those totals differ from the app.** The SQL Editor connects as an admin role that bypasses RLS,
so it sees all four accounts — 8 tags in total. The app connects with a user session and `tags_select`
limits it to `user_id = auth.uid()`, so signed in as `florian.eisler@gmail.com` the sidebar shows 2.
Same table, a different answer depending on who asks: that is the scoping requirement working, not the
app dropping rows. Confirmed by impersonating each role in a rolled-back transaction — admin 8,
owner 2, `abc@test.de` 4, anonymous 0.

## The auth-flaw scan

The lesson's scan file was not to hand, so the rule was written for this repo instead:
[`.claude/commands/auth-flaw-scan.md`](.claude/commands/auth-flaw-scan.md). It is not diff-scoped — an
auth hole is a property of the app as it stands, so a page that was already unprotected is a finding
even on a branch that never touched it. Eight checks: server-side page gates, `getUser()` rather than
`getSession()`/`getClaims()`, Server Actions gating themselves, secrets never reaching the browser, RLS
on with real policies, Supabase owning passwords, nothing in web storage, and no open redirect on the
`?next=` auth returns.

It ran on 18 August 2026 and came back **clean — no findings**. The report, with the command run for
each check and what came back, is [`docs/auth-scan.md`](docs/auth-scan.md). Two results are worth
lifting out: all **22** Server Actions call `await requireUser()` *before* their `try` block, and
impersonating roles in a rolled-back transaction returned 5 notes for one owner, 3 for another and
**0** for `anon` — with no policy anywhere granted to `anon`.

## The tags deviation, stated deliberately

The brief says "add a tags column to the notes table". This app uses a `tags` table plus a `note_tags`
join instead. A tag therefore has one name and one colour reused across every note that carries it,
rather than a string repeated per row — so renaming or recolouring a tag is a single write, deleting
one cascades its links and leaves the notes intact, and "work" and "Work" cannot become two pills that
look identical. Same feature as asked for, normalised.

## Optional tasks delivered

Nine, each on its own feature branch and merged through a pull request.

| Task | Tier | PR |
| --- | --- | --- |
| Collections and tag-based filtering | Medium | [#2](../../pull/2) |
| Server-side search (Postgres full-text) | Medium | [#2](../../pull/2) |
| Loading states — skeletons, never a blank flash | Easy | [#3](../../pull/3) |
| Minimalist design pass | Easy | [#4](../../pull/4) |
| Export a note to Markdown | Medium | [#5](../../pull/5) |
| Image uploads to Supabase Storage | **Hard** | [#6](../../pull/6) |
| Password-reset email flow | Medium | [#8](../../pull/8) |
| Self-service sign-up with confirmation email | Medium | [#8](../../pull/8) |
| GitHub social login | **Hard** | [#8](../../pull/8) |

## Fresh-session diff review

**No review here ran in a genuinely fresh session, and I would rather say so than imply otherwise.**
Checked against the session transcripts rather than recalled: PR #2 was created at
`2026-08-12T11:46:08Z` and `/claude-md-review 2` ran at `2026-08-12T11:48:31Z` — two minutes later, in
the same session (`8141019c`, which spans 12–13 August). Same context that wrote the code, so it cannot
count as context-free.

I could have opened a new session late in the project and run a review purely to tick this box. I
decided not to. It would have been a review of code that had already been reviewed, chosen for the
label rather than for anything it might find, and the honest record seemed worth more than the tick.

What the reviews *did* produce is below, and it is the substantive part either way.

**Finding.** The review of PR #2 produced five findings serious enough to hold up further work, and
they were fixed as their own PR rather than folded into the next feature — [#7](../../pull/7),
"close the five outstanding findings from the PR #2 review". The most useful of them was structural
rather than cosmetic: writes that targeted a single row by id did not read that row back, so a write
to a row RLS hid from the caller returned zero rows with `error: null` and reported success while
changing nothing. `assertWriteHit()` in `lib/db/index.ts` now guards every such write, with three
deletes exempted on purpose and each saying so in place.

## Data, column by column

Criterion 4 allows this in the review call, which is where I plan to show it. The crib:

- `notes.id` — `uuid`, `gen_random_uuid()`.
- `notes.user_id` — `uuid`, **defaults to `auth.uid()`**, which is why no insert in `lib/db/` passes
  it and why RLS can check ownership on the way in as well as out.
- `notes.collection_id` — nullable, so a note can be uncategorised; that is the "Uncollected" group.
- `notes.pinned` / `archived` — booleans behind the sidebar's ordering and its Archive section.
- `notes.updated_at` — maintained by a database trigger, not application code. It fires on every
  `UPDATE`, so pinning or archiving moves it too; it is not "last edited by hand".
- `notes.search_vector` — a generated `tsvector` with a GIN index, kept in step by Postgres.

**How a row appears.** Clicking **New note** calls a Server Action, which calls `createNote()` in
`lib/db/`. That issues one `insert` carrying only `collection_id`; `title` and `body` are `not null
default ''`, and `user_id`, `id` and the timestamps all come from column defaults. RLS checks
`user_id = auth.uid()` on the way in, the insert returns the new id, and the action redirects to
`/notes/<id>`.

## What I would do differently

Two honest sentences: the workspace revalidates as a whole layout after every mutation, which is
simple and correct but re-runs four queries for a change as small as flipping `pinned` — I would scope
that more tightly next time. And I would have written CLAUDE.md's rules earlier: the ones added
partway through, like the read-back guard, were the ones the agent broke before they existed.
