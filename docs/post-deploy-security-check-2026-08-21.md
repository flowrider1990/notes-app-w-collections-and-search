# Post-Deploy Security Check — 2026-08-21

## Scope

The analysis was read-only. Nothing in the Vercel project or the Supabase project was
changed, and no existing audit file was touched.

One code change came out of it, after the fact: section 5's residual check was performed
by hand, turned out to be a Low finding, and was fixed by two `headers()` rules in
`next.config.ts`. That is the only application change, and it is **not yet deployed**.

This was a gap analysis against the two tutorial security requirements, not a fresh
audit. It reused [`auth-scan.md`](auth-scan.md) (18 August 2026, commit `1b5836f`) and
[`audit-2026-08-19.md`](audit-2026-08-19.md) as the baseline and re-checked only what
those do not conclusively cover at `HEAD` — the auth scan is 34 commits stale, so its
structural claims were re-run rather than trusted. All of its findings still hold.

Specifically covered:

- server-side authentication **and** record-level authorization for every mutation path
- logging of secrets, tokens or personal data
- production source-map exposure
- Next.js image origin restrictions
- caching of authenticated private data

## Results

### 1. Mutation authorization

- **23** mutation actions in [`app/notes/actions.ts`](../app/notes/actions.ts) checked.
- All 23 call `requireUser()` **before** the `try`, so the redirect is never swallowed
  into an `{ error }` result.
- Ownership for the affected record is enforced through RLS: every owner-scoped table
  has `select` / `insert` / `update` / `delete` policies bound to
  `user_id = (select auth.uid())`, with a `with check` on every `update`. Each
  single-row write ends `.select("id")` and passes the result to `assertWriteHit()`, so
  a policy miss surfaces as an error rather than a silent no-op.
- Composite ownership checks exist where a write spans two owned rows:
  `notes_insert` / `notes_update` re-check **collection** ownership; `note_tags_insert`
  checks **both** the note and the tag; `note_images_insert` binds to a note the
  uploader owns; the Storage policies pin the `{user_id}/` path prefix.
- **No auth-only mutation path was found.** No action authenticates the caller and then
  writes without record-level authorization.
- The OAuth and email-confirmation route handlers
  ([`/auth/callback`](../app/auth/callback/route.ts),
  [`/auth/confirm`](../app/auth/confirm/route.ts)) are anonymous by design — they are
  what establishes a session — and are guarded by the tested `safeNextPath` invariant.
  They are the only two route handlers; there are no API routes and no `fetch` /
  `axios` / `XMLHttpRequest` call sites in `app`, `lib` or `components`.

Status: **Covered**

### 2. Logging

- No API keys, auth tokens or passwords were found in any application logging path.
- Exactly one server-side error logging path exists,
  [`actions.ts:84`](../app/notes/actions.ts#L84), and it fires only on the branch whose
  message is *withheld* from the user — a user-facing message is already on screen, so
  a copy in the log would add nothing.
- Postgres diagnostics reaching that log may include limited user-originated values —
  a tag or collection name quoted out of a constraint violation, and a `user_id` UUID.
- `/share/<token>` carries a bearer-style token in the URL path, so the token may appear
  in Vercel access logs.

Status: **Covered with Low residual notes**

### 3. Production source maps

- `productionBrowserSourceMaps` is not enabled in
  [`next.config.ts`](../next.config.ts) — Next's default is off.
- No client `.map` files are shipped: zero under `.next/static`.
- Every deployed client chunk linked from `/auth/login` was fetched and contains no
  `sourceMappingURL` comment.
- Direct `<chunk>.map` requests against the production alias return **403**.

The `.map` files under `.next/server` are inside the serverless function bundle and are
not routable.

Status: **Covered**

### 4. Next.js image configuration

Confirmed against the *built* `images-manifest.json`, not only the source config:

- One explicit Supabase origin: `https` + the hostname resolved from
  `NEXT_PUBLIC_SUPABASE_URL` + `pathname: /storage/v1/object/**`.
- No hostname wildcard.
- `domains: []`.
- `dangerouslyAllowSVG: false`, `dangerouslyAllowLocalIP: false`; the optimizer's own
  CSP is `script-src 'none'; frame-src 'none'; sandbox`.
- `minimumCacheTTL` is `14400` (4 h) while `SIGNED_URL_TTL_SECONDS` is `3600` (1 h).

Status: **Covered**

Residual finding: **Low — optimizer cache can outlive signed URL validity.** The
optimized response stays retrievable for up to 4 h from a `/_next/image?url=…` request
whose underlying signature expired after 1 h. The cache key is the full signed URL, so
this is not cross-visitor on its own — it extends the window on a URL that has already
leaked.

### 5. Private-data caching

Proven:

- `/notes`, `/notes/[id]` and `/auth/update-password` are `PARTIALLY_STATIC` (PPR). The
  CDN-cached artifact is the static shell, and those shells were grepped for UUIDs,
  email addresses, `eyJ`, `sb_publishable_` and `user_id` — **no user data**.
- User-specific data sits behind Suspense and is resumed dynamically per request.
  `prefetchDataRoute` is absent for `/notes` and `/notes/[id]`, so there is no
  prerendered RSC payload for router prefetches to hit.
- Unauthenticated `/notes` and `/notes/<id>` requests return **307 to `/auth/login`**
  from the proxy; no HTML body is served without a session.
- The deployed client bundle (≈873 KB across all chunks) contains only
  `sb_publishable_…` — no `service_role`, `sb_secret_`, `sbp_`, `eyJ…` JWT, and no
  email address or other private identifier.
- No application-level cache APIs or revalidation configuration were found: no
  `use cache`, no `unstable_cache`, no `export const revalidate`, no
  `export const dynamic`. `revalidateWorkspace()` is path revalidation, not a shared
  response cache.

**Manual verification, performed.** The authenticated request was made by hand from a
signed-in browser session against the production alias. No cookie or token value is
recorded here. Observed on the authenticated **200** `/notes`:

| Header | Observed |
| --- | --- |
| `Cache-Control` | `public, max-age=0, must-revalidate` |
| `X-Vercel-Cache` | `HIT` |
| `Age` | `8` |
| `X-Nextjs-Prerender` | `1` |
| `private` | absent |
| `no-store` | absent |

**Classification: Finding, Low — addressed in code, awaiting live verification.**

This is *not* a confirmed cross-user data leak, and should not be recorded as one. The
`X-Vercel-Cache: HIT` is the PPR shell, which was grepped and holds no user data; the
notes themselves are resumed per request and are not written into the shared cache
entry. A separate probe supports this: the cached `HIT` body for `/share/<random-token>`
contains the shell only, with no token-specific render in it. The defect is narrower —
a response whose body is one person's notes went out labelled `public`, with no
`Vary: Cookie`, and `max-age=0, must-revalidate` only obliges a *compliant* shared cache
to revalidate before reuse. A private authenticated route should state a non-shared
policy outright rather than depend on intermediaries behaving well.

**Fix applied in code** (not yet deployed) — [`next.config.ts`](../next.config.ts) gains
two `headers()` rules that send `Cache-Control: private, no-store` on the signed-in
routes only:

| Route pattern | Applies to |
| --- | --- |
| `/notes/:path*` | `/notes`, `/notes/[id]`, anything below |
| `/auth/update-password` | that page only |

Public routes are untouched: `/` and the signed-out auth pages keep `s-maxage=31536000`,
and `/share/[token]` keeps its own policy — serving one shared collection to many
strangers is the whole feature. The CSP, `X-Frame-Options` and `X-Content-Type-Options`
rule is unchanged and still applies to every route, and PPR is preserved — the build
still marks `/notes`, `/notes/[id]`, `/auth/update-password` and `/share/[token]` as
`◐ Partial Prerender`. The header is a response header; Vercel decides what to keep in
its own cache from the prerender manifest, so the shell is still served from the edge.

Verified locally against `next start` on the production build — a single
`Cache-Control: private, no-store` on all three private routes, no duplicate header,
security headers intact, `/`, `/auth/login` and `/share/[token]` unchanged. The
generated regexes in `.next/routes-manifest.json` were checked to confirm
`/notes/:path*` matches `/notes` and nothing outside the workspace.

Status: **Finding addressed in code — requires live verification after deployment**

**Live verification still required.** The fix is not deployed. Production is promoted by
hand (`vercel.json` sets `git.deploymentEnabled` to `{"main": false}`), so the alias
still serves the old header until someone runs `npx vercel --prod`. After deploying,
repeat the authenticated request above and confirm `Cache-Control: private, no-store`
on the 200. Until that is observed, this item stays open.

## Open Low findings

Backlog, not blockers:

1. The image optimizer cache TTL (4 h) exceeds the signed image URL TTL (1 h).
2. Share tokens may appear in access logs, because they are URL-path bearer tokens.
3. Authenticated pages advertised a `public` cache policy. Fixed in `next.config.ts`,
   **not yet live** — see section 5.

## Conclusion

- Tutorial requirement 1 is **satisfied**.
- Tutorial requirement 2 is **satisfied in code**. The one residual check from the
  original pass has been performed, turned out to be a Low finding, and has been fixed
  in `next.config.ts`. The fix is **not deployed**, so requirement 2 is not yet
  confirmed on the live alias — see the live verification step in section 5.
- No Critical / High / Medium remediation loop was opened.
- No accepted or deferred security findings were reopened. In particular,
  leaked-password protection remains deliberately off, and `public.shared_collection`
  remains the sanctioned RLS bypass — both stay as recorded in `auth-scan.md`.
