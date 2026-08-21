---
description: Scan only what this branch changed — dispatches the Supabase, Next.js and Vercel security scanners in parallel, scoped to the diff against main
argument-hint: "[base-branch] (defaults to main)"
allowed-tools: Bash(git:*), Read, Grep, Glob, Task, Agent
---

# Security-scan what this branch changed

Run the three security scanners over **the files this branch touched**, not the whole codebase.

A full audit is the right tool before a release; this is the one for the middle of the work, when you
want to know whether the change you just made introduced something — fast enough to run before every
merge. The three scanners look at different layers and are independent of each other, so they run
**in parallel**, in a single dispatch.

Nothing here fixes anything. All three agents are read-only by construction, and this command adds
no writes of its own: no commit, no stash, no branch switch.

## 1. Establish the base and the diff

The base branch is `$1` if one was given, otherwise `main`.

```bash
git rev-parse --show-toplevel
git branch --show-current
git fetch --quiet origin                        # moves origin/<base>, not the local ref
git merge-base HEAD origin/<base>               # the fork point — not the base tip
git diff --name-only $(git merge-base HEAD origin/<base>)...HEAD
git diff --name-only HEAD                       # uncommitted tracked edits
git status --porcelain=v1 --untracked-files=all  # untracked files, one line each
```

Use the **merge base**, not the base branch tip. A two-dot `git diff main..HEAD` also lists commits
that landed on `main` after this branch started, which pads the scan with other people's work and
buries the findings that are actually yours.

Two details in those commands are easy to get wrong:

- **Compare against `origin/<base>`, not the local one.** `git fetch` updates the remote-tracking
  ref and leaves the local branch where it was, so a merge base computed against a stale local
  `main` can silently include work that is already merged. Fall back to the local ref when there is
  no remote — that is the offline case, and it should degrade rather than fail.
- **`--untracked-files=all`.** The default collapses a newly added directory into a single
  `?? dir/` line, and step 3 needs real paths to hand to the agents. Read the `??` entries out of
  that output yourself rather than piping into `grep`: the pipeline leaves `Bash(git:*)` territory
  and turns an unattended step into a permission prompt.

The scope is the union of three sets: committed changes since the fork point, uncommitted edits to
tracked files, and untracked files. All three are part of what this branch is proposing, and a
half-finished file is exactly where a mistake lives. Label which is which when you list them, so a
finding in an uncommitted file is recognisable as one you can fix without a new commit.

**Handle these cases before dispatching anything:**

- **The current branch *is* the base** (commonly `main`). There is no branch diff, so compare against
  the remote instead: `git diff --name-only origin/<base>...HEAD` picks up unpushed commits. If that
  is empty too and the tree is clean, there is nothing to scan — say so in one line and stop. Do not
  silently widen to a full-codebase audit; that is `/auth-flaw-scan` and it takes much longer.
- **The base does not exist locally.** Try `origin/<base>`. If neither resolves, stop and say which
  names you tried rather than guessing at `master` or `develop`.
- **Detached HEAD.** The diff still works; say so, since "this branch" has no name to report.
- **Nothing in the diff has a security surface.** Say that plainly and skip the dispatch. Three
  agents reading a `package-lock.json` diff produce noise, not findings. Judge this by path, not by
  the category "docs", and check the exclusion against the table in step 2 before applying it:
  lockfiles, images, `README.md`, `CHANGELOG.md` and prose under `docs/` qualify; `docs/schema.sql`
  emphatically does not, because `CLAUDE.md` sanctions a schema change landing *only* there when the
  Supabase CLI is unavailable, so "only docs changed" would skip the single highest-value diff this
  command can be handed. `.claude/` prompt and agent definitions qualify too — they change how a
  scan behaves, never what the deployed app serves. A dependency *bump* is a real security question,
  but a different one: dependency auditing, not code scanning.

## 2. Decide which scanners have something to look at

All three are dispatched together, but each is told what in the diff belongs to it, and each is told
to report honestly when the answer is "nothing in this diff touches my layer". That last instruction
matters more than it looks: an agent given no relevant input tends to go looking for work, and what
it comes back with is a full-codebase audit you did not ask for.

Rough map of the layers, as a starting point rather than a rule — read the diff and judge:

| Scanner | What in a diff belongs to it |
| --- | --- |
| `supabase-security-scanner` | `lib/db/**`, `supabase/migrations/**`, `docs/schema.sql`, RLS policies, Storage bucket rules, anything touching `auth.uid()`, `security definer`, or a Supabase key |
| `nextjs-security-scanner` | `app/**` pages, layouts, `actions.ts`, route handlers, `middleware.ts`/proxy, Server/Client component boundaries, `NEXT_PUBLIC_` usage, what gets passed into a client component |
| `vercel-security-scanner` | `next.config.ts` headers, `vercel.json`, `.gitignore`, `.env*`, environment-variable reads, and anything that changes what a response carries or who can reach a deployment |

The Vercel scanner deserves a note, because most of its subject is *configuration rather than files*
and therefore does not decompose into a diff at all. Only one of its checks genuinely does: the
headers a project configures and serves, in `next.config.ts` and `vercel.json`. Environment-variable
scoping, Deployment Protection on preview URLs and the git-history secret sweep are properties of
the account and of the whole history, not of these commits — they belong to a full audit, and asking
for them here yields either a full audit or a shrug.

So scope this one deliberately: the header and config surface the diff moves, plus any secret or
env-var reference the diff itself introduces. Tell it that its remaining checks are **out of scope
for this run** rather than leaving it to infer that from silence, and have it name them as not run,
so nobody reads a quiet report as an audited deployment. If the diff moves none of that surface,
one line saying so is its correct answer.

## 3. Dispatch all three, in one message

Send all three agent calls in a **single** message so they run concurrently. Dispatching them one at
a time triples the wait for no benefit — they share no state and none of them needs another's output.

Give each agent the same three things:

1. **The explicit file list**, verbatim, marked as committed / uncommitted / untracked. Paths, not a
   description of them — an agent that has to rediscover the scope will scan more than you asked.
2. **The base and head refs**, so it can read the diff itself with
   `git diff <merge-base>...HEAD -- <paths>` and see what changed rather than only the current state.
   Both matter: the current state shows what is true now, the diff shows what this branch did.
3. **The scoping instruction**, in words that survive an agent's urge to be thorough:

   > Scope: report security risks **introduced or affected by** the files listed above. You may
   > freely read anything unchanged that you need in order to evaluate them — a dependency a changed
   > file imports, an RLS policy a changed migration alters, configuration a changed route relies on,
   > the callers of a function whose signature moved, `CLAUDE.md`. Reading widely is expected;
   > *reporting* is what is scoped.
   >
   > Do not report unrelated pre-existing findings. If a problem exists independently of this diff
   > and the diff neither created it nor changed its consequences, it is out of scope for this run —
   > mention it in one line as context only if it changes how a real finding should be read, and
   > otherwise leave it. If nothing in the listed files touches your layer, say exactly that in one
   > line instead of widening the scan.
   >
   > Where your own checklist contains a check that cannot be narrowed to a diff — a live account
   > setting, a whole-history sweep, an enumeration of every table or every `"use server"` file —
   > this scoping governs what you *report*, not which checks you are allowed to run. Run what you
   > judge necessary, then report only what this diff introduced or affected, and list the checks you
   > deliberately did not narrow as not covered by this run.

   That last paragraph exists because each of these agents carries its own whole-project checklist
   and is told to work through all of it. A calling prompt cannot overrule that, and pretending
   otherwise makes each run resolve the conflict differently — sometimes the full audit this command
   is trying to avoid, sometimes an agent quietly skipping its own checks. Naming the tension and
   putting it on the reporting side is what makes the outcome predictable.

   "Affected by" is the part worth being careful about, and it is why the instruction is not "the
   changed line must be the cause". A diff can make unchanged code newly dangerous without touching
   it: a new caller reaching an existing helper that never checked its own caller, a migration
   relaxing a policy that other tables' access depends on, a header or config change that removes a
   protection something else was quietly relying on. Those are in scope, and the finding should say
   plainly which changed file put the unchanged code in that position — that link is what separates a
   real finding here from the pre-existing noise the previous paragraph excludes.

Keep each agent's own report format — they group findings by severity in their own way, and
rewriting that in the prompt only makes them less consistent with their standalone runs.

## 4. Consolidate

One report, not three pasted together. The point of running them together is the combined picture.

1. **Verdict** — one line: N findings by severity across all three, and how many checks came back
   unverifiable. "Clean" is only honest when the layers were actually reachable; otherwise the
   verdict says clean *so far as it could be checked* and points at item 4.
2. **Scope** — base ref, head sha, branch name, and the file count with the three categories. A
   reader has to be able to tell what was *not* looked at.
3. **Findings**, worst first, merged across scanners. Each: `file:line`, which scanner raised it,
   what an attacker or a signed-out visitor gets, and the fix. Where the finding sits in unchanged
   code, name the changed file that made it reachable or dangerous — without that link a reader
   cannot tell it apart from a pre-existing issue that should not have been reported at all. Where
   two scanners flag the same line
   from different angles, merge them into one finding and keep both angles — that overlap is usually
   the strongest signal in the report, not a duplicate to be tidied away.
4. **Could not be verified** — every check that came back inconclusive or was left out of scope,
   one line each, naming what would settle it. This section is not optional padding, and it is not
   the same as item 5. In this repo it is the *normal* case for the deployment layer: the checkout is
   deliberately unlinked, so an unauthenticated CLI turns most live Vercel checks into "unknown".
   A run where nothing about the deployment could be checked must not print the verdict "clean" —
   that is precisely the half-working report this command exists to avoid.
5. **Layers with nothing to report** — one line each. Silence from a scanner, a clean result from it,
   and a result it could not obtain are three different outcomes, and the difference is what you are
   actually deciding on when you decide whether to merge.

Do not invent findings to make the run look worthwhile; a clean diff is a good outcome, stated in a
line. Do not soften a real one either, and do not defer to the fact that this repo has been audited
before — the whole reason to scan a diff is that the last audit did not include it.

If the findings warrant fixing, stop after reporting and let the user decide. Fixing is separate
work, and it ends in a new commit — which means this command should run again.
