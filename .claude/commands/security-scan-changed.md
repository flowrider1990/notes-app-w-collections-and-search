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
git fetch --quiet origin
git merge-base HEAD <base>            # the fork point — not the base tip
git diff --name-only $(git merge-base HEAD <base>)...HEAD
git diff --name-only HEAD             # uncommitted tracked edits
git status --porcelain=v1 | grep '^??' # untracked files
```

Use the **merge base**, not the base branch tip. A two-dot `git diff main..HEAD` also lists commits
that landed on `main` after this branch started, which pads the scan with other people's work and
buries the findings that are actually yours.

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
- **Only lockfiles, images or docs changed.** Say that plainly and skip the dispatch. Three agents
  reading a `package-lock.json` diff produce noise, not findings. A dependency *bump* is a real
  security question, but it is a different one — dependency auditing, not code scanning.

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

The Vercel scanner deserves a note, because its subject is mostly *configuration rather than files*.
Scope it to the deployment surface the diff actually moves — a changed header, a new env var, an
altered ignore rule, a secret that appears in the diff. Do not let it drift into auditing account
settings that this branch never touched; if the diff moves none of that surface, its correct answer
is a single line saying so.

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

1. **Verdict** — one line: clean, or N findings by severity across all three.
2. **Scope** — base ref, head sha, branch name, and the file count with the three categories. A
   reader has to be able to tell what was *not* looked at.
3. **Findings**, worst first, merged across scanners. Each: `file:line`, which scanner raised it,
   what an attacker or a signed-out visitor gets, and the fix. Where the finding sits in unchanged
   code, name the changed file that made it reachable or dangerous — without that link a reader
   cannot tell it apart from a pre-existing issue that should not have been reported at all. Where
   two scanners flag the same line
   from different angles, merge them into one finding and keep both angles — that overlap is usually
   the strongest signal in the report, not a duplicate to be tidied away.
4. **Layers with nothing to report** — one line each. Silence from a scanner and a clean result from
   it are different outcomes, and the difference matters when you are deciding whether to merge.

Do not invent findings to make the run look worthwhile; a clean diff is a good outcome, stated in a
line. Do not soften a real one either, and do not defer to the fact that this repo has been audited
before — the whole reason to scan a diff is that the last audit did not include it.

If the findings warrant fixing, stop after reporting and let the user decide. Fixing is separate
work, and it ends in a new commit — which means this command should run again.
