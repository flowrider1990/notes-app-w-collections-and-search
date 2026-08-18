---
description: Scan the app for basic authentication flaws before merging, and write the result to docs/
argument-hint: (none — scans the whole app)
allowed-tools: Bash(git:*), Bash(npx supabase:*), Bash(date:*), Read, Grep, Glob, Write
---

# Scan for basic auth flaws

Scan this application for the authentication and access-control flaws that matter most, then **write
the result to `docs/auth-scan.md`**. Run it before merging anything that touches auth, session
handling, database access, or environment variables.

Unlike `/claude-md-review`, this is not diff-scoped: an auth hole is a property of the app as it
stands, not of the lines that happen to have changed. A page that was already unprotected is a
finding even if this branch never touched it.

**Verify, do not assume.** Every check below has a command or a file to read. Run it. A claim in
`CLAUDE.md` or in a previous scan is not evidence that the code still does what it says.

## 1. Every signed-in-only page is gated on the server

Workspace routes must verify the session **before** they render, and redirect when there is no user.

- List the routes: `Glob app/**/page.tsx` and `app/**/layout.tsx`.
- Every page or layout under `app/notes/` must reach `requireUser()` from `lib/db/auth.ts`, directly
  or through a parent layout that does.
- `/share/**` is exempt by design — it is the one anonymous read path. `app/auth/update-password` is
  **not** exempt: the recovery link is what grants the session.
- The redirect in `lib/supabase/proxy.ts` does not count as a gate. It runs before the route and can
  be bypassed. Confirm it exists, then judge each page on its own check.

## 2. Identity comes from the Auth server, not from the token

`grep -rn "getSession\|getClaims\|getUser" lib app components`

- `getUser()` asks Supabase and is the only acceptable gate.
- `getSession()` reads storage and verifies nothing — a finding wherever it decides access.
- `getClaims()` is **also** a finding for gating. With asymmetric signing keys it verifies locally
  against a cached JWKS and never contacts the Auth server, so a signed-out or revoked session keeps
  passing until the token expires. This exact flaw was present in this repo once.

## 3. Server Actions gate themselves

A Server Action is a POST endpoint the page gate never covers.

- Read every exported function in `app/**/actions.ts`.
- Each must open with `await requireUser()`, placed **before** the `try`. Inside it, the `catch`
  swallows the `NEXT_REDIRECT` that `requireUser()` throws and reports it to the user as a failed
  save — so a call inside `try` is a finding, not a style note.

## 4. No secret ever reaches the browser

- `grep -rn "SERVICE_ROLE\|service_role\|SUPABASE_SECRET\|sbp_" app components lib`
- `grep -rn "NEXT_PUBLIC_" . --include="*.ts" --include="*.tsx"` — only the Supabase URL and the
  publishable key (`sb_publishable_…`) belong here. A `NEXT_PUBLIC_` prefix inlines a value into the
  client bundle, and a personal access token (`sbp_…`) is account-wide.
- `git check-ignore -v .env.local` must print a rule. If it prints nothing, that is the top finding.
- `git log --all --name-only | grep -i "env"` — a secret committed once stays in history.

## 5. RLS is on, and policies are owner-scoped

Ask the database, not the docs:

```sql
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
```

- `relrowsecurity` false on any table holding user data is a finding.
- RLS enabled with **zero** policies is worse than it looks: reads return `[]` with `error: null`, so
  it presents as an empty app rather than a permission failure.
- Prove scoping rather than reading policy text — impersonate in a rolled-back transaction:
  `begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'; select count(*) from public.notes; rollback;`
  Two different `sub` values must return different counts, and `set local role anon` must return 0.

## 6. Supabase Auth owns passwords and sessions

- `grep -rniE "bcrypt|argon|scrypt|createHash|pbkdf2|salt" app components lib` — any password hashing
  in application code is a finding.
- No password column in `docs/schema.sql`; no session minted or validated by hand.
- Only Supabase calls change credentials: `signInWithPassword`, `signInWithOAuth`, `signUp`,
  `updateUser`, `resetPasswordForEmail`, `signOut`.

## 7. No user data in web storage

`grep -rn "localStorage\|sessionStorage" app components lib`

Any note, title, body or tag written to either is a finding — this project forbids it outright. A
Supabase-internal cookie store is fine; application data is not.

## 8. Open redirects on auth returns

Both `app/auth/callback/route.ts` and `app/auth/confirm/route.ts` take a `?next=` from an email or a
provider. Each must pass it through `safeNextPath()` in `lib/auth-redirect.ts`, which accepts in-app
paths only and rejects `//host`. A raw `redirect(next)` is a finding.

## Report

Write the report to **`docs/auth-scan.md`**, overwriting any previous one, and print a two-line
summary to the terminal. Structure it as:

1. **Verdict** — one line: clean, or N findings by severity.
2. **Date, commit and branch** — `git rev-parse --short HEAD` and `git branch --show-current`, so a
   reader knows what was scanned.
3. **Findings**, worst first. Each: `file:line`, what an attacker or a signed-out visitor could do,
   and the fix. Skip this section entirely if there are none.
4. **What was checked and how** — one line per numbered section above, naming the command run and
   what came back. This is the part that makes the scan auditable rather than a claim.

**Do not invent findings**, and do not pad the report to look thorough. A clean result stated plainly
with the evidence beneath it is the useful outcome. Equally, do not soften a real one: an ungated page
or a leaked key is a finding regardless of how tidy the rest is.
