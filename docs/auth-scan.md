# Auth flaw scan

Produced by [`/auth-flaw-scan`](../.claude/commands/auth-flaw-scan.md). Re-run it before merging
anything that touches auth, session handling, database access or environment variables, and commit the
regenerated file with that change.

## Verdict

**Clean — no findings.** Eight checks, all passed, each verified by running something rather than by
reading a claim in `CLAUDE.md`.

## What was scanned

| | |
| --- | --- |
| Date | 18 August 2026 |
| Branch | `feature/workspace-sidebar` |
| Commit | `1b5836f` **plus uncommitted working tree** — the workspace sidebar, tag manager and archive-delete work was not yet committed when this ran |
| Database | the linked Supabase project, inspected live |

## What was checked, and how

**1. Every signed-in-only page is gated on the server.** Listed all 12 `page.tsx` / `layout.tsx` files
and checked each for `requireUser()`. `app/notes/layout.tsx` and `app/notes/[id]/page.tsx` call it;
`app/notes/page.tsx` inherits the gate from that layout. `app/auth/update-password/page.tsx` calls it
too, which is correct — the recovery link is what grants the session, so an expired link must redirect
rather than show a form. The only match inside `app/share/[token]/page.tsx` is a comment explaining why
that route deliberately sits outside `app/notes/`; it is the one anonymous read path by design.

**2. Identity comes from the Auth server.** `grep` for `getUser` / `getSession` / `getClaims` across
`lib app components`. `requireUser()` in `lib/db/auth.ts` uses **`getUser()`**. No `getSession()`
anywhere. `getClaims()` appears only in `lib/supabase/proxy.ts`, and only to decide whether to bounce a
signed-in visitor off the landing page — nothing is protected by it, and a forged token lands on
`/notes` where `requireUser()` asks the Auth server and turns it away. This is the flaw class that was
genuinely present in this repo once: `requireUser()` used to call `getClaims()`, which verifies locally
against a cached JWKS and never contacts Supabase, so a revoked session kept passing until its token
expired. Fixed before this scan.

**3. Server Actions gate themselves.** Parsed `app/notes/actions.ts` and checked every exported
function for `await requireUser()` positioned *before* any `try`. **22 of 22 pass, 0 problems.**
Position matters: `requireUser()` redirects by throwing, and these `catch` blocks convert a throw into
`{ error }`, so a call inside the `try` would report `NEXT_REDIRECT` to the user as a failed save.

**4. No secret reaches the browser.** No `SERVICE_ROLE`, `service_role`, `SUPABASE_SECRET` or `sbp_`
token anywhere in `app components lib`. Exactly two `NEXT_PUBLIC_` variables are read —
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — which is the intended pair.
`git check-ignore -v .env.local` resolves to `.gitignore:26`. The only env file in the whole git
history is `.env.example`, which contains placeholders (`your-project-url`), not values.

**5. RLS is on and scoping is real.** Asked `pg_class` / `pg_policies` directly:

| Table | RLS | Policies |
| --- | --- | --- |
| `collections` | on | 4 |
| `note_images` | on | 3 |
| `note_tags` | on | 3 |
| `notes` | on | 4 |
| `search_history` | on | 4 |
| `tags` | on | 4 |

No table has RLS off, and none has zero policies — which would be worse than it looks, since reads
would then return `[]` with `error: null` and present as an empty app rather than a permission failure.

Scoping was then proven rather than read, by impersonating roles inside a rolled-back transaction:

| Viewer | `notes` visible |
| --- | --- |
| owner A (`80e87239…`) | 5 |
| owner B (`e5caef3d…`) | 3 |
| `anon` | **0** |
| `anon`, `note_images` | **0** |

**No policy anywhere is granted to `anon`.** The share link reaches its data through the
`security definer` function `public.shared_collection(token uuid)`, which is deliberate: an anon policy
permissive enough to serve a share link would also let a stranger select every shared collection and
read the tokens out of the table.

**6. Supabase Auth owns passwords and sessions.** No `bcrypt`, `argon`, `scrypt`, `pbkdf2`,
`createHash` or `salt` in `app components lib`. No password column in `docs/schema.sql`. Credentials
change only through `supabase.auth.*`, wrapped in `lib/db/auth-browser.ts`.

**7. No user data in web storage.** `grep localStorage|sessionStorage` over `app components lib`
returns **nothing**. Supabase is the only persistence layer.

**8. No open redirect on auth returns.** Both `app/auth/callback/route.ts` and
`app/auth/confirm/route.ts` pass their `?next=` through `safeNextPath()` from `lib/auth-redirect.ts`,
which accepts in-app paths only and rejects protocol-relative `//host`. Three redirect sites, all
guarded; no raw `redirect(next)`.

## Known and accepted

- **Leaked-password protection is off** in Supabase Auth settings. A paid-tier feature, deliberately
  not enabled for this exercise. Not a code defect.
- **`public.shared_collection` is executable by `anon`.** That is the sanctioned RLS bypass and the
  whole mechanism behind share links. It is hardened with `set search_path = ''` and every reference
  schema-qualified.
