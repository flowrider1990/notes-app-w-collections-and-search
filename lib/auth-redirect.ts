/**
 * Where a signed-in user lands: the workspace, which is the whole app.
 *
 * Every way in reads it from here — the email/password form pushes it after
 * `signInWithPassword`, the OAuth and email-confirmation routes redirect to it once
 * the token is exchanged, and sign-up hands it to Supabase as the confirmation
 * link's destination — so they cannot drift apart. Changing where people land is a
 * one-line edit in this file.
 */
export const AFTER_SIGN_IN_PATH = "/notes";

/**
 * Resolves a `?next=` parameter to somewhere it is safe to send someone.
 *
 * Both auth routes take a destination from the query string, and both are handed
 * that string by an email or an OAuth provider rather than by our own code. Only a
 * destination on this origin is allowed: anywhere else turns either route into an
 * open redirect that fires *after* a genuine sign-in, which is the most convincing
 * shape a phishing hand-off can take.
 *
 * Two checks, and both are needed:
 *
 * 1. **The input must resolve to this origin.** This is a real URL resolution, not a
 *    look at how the string starts. Prefix matching cannot do this job: a browser
 *    resolving a `Location:` header treats `\` as `/` in an http(s) URL, so
 *    `/\evil.com` begins with a single slash, passes any "starts with `/` but not
 *    `//`" check, and still lands on `evil.com`.
 * 2. **The path this resolves *to* must not itself be protocol-relative.** Passing
 *    check 1 is not enough, and this is the part that is easy to get wrong: `/.//evil.com`,
 *    `/..//evil.com` and `http://this-origin//evil.com` all resolve to this origin —
 *    check 1 is satisfied — yet all three normalise to the pathname `//evil.com`. Hand
 *    that back and the browser reads the `Location:` header as protocol-relative and
 *    goes to `evil.com` after all. So a result is only returned when its path starts
 *    with exactly one slash.
 *
 * What comes back is always a relative path, even when `next` arrived as an absolute
 * same-origin URL. That is deliberate but it is *not* what makes the result safe —
 * check 2 is. It matters because `origin` is derived from the request: a forged `Host`
 * header could in principle make an attacker's own host look same-origin, and a
 * single-slash relative path is resolved by the browser against the origin it is
 * actually talking to, so the forged header buys nothing.
 *
 * Anything that fails either check falls back to the workspace rather than erroring —
 * the user completed their part correctly, and a tampered `next` is not their problem
 * to read about.
 */
export function safeNextPath(next: string | null, origin: string): string {
  if (!next) return AFTER_SIGN_IN_PATH;

  try {
    const base = new URL(origin);
    const resolved = new URL(next, base);

    // Check 1. Exact origin match — scheme, host and port together. Note that a
    // non-http(s) scheme (`javascript:`, `data:`) resolves to the opaque origin
    // `"null"`, so it fails this comparison too.
    if (resolved.origin !== base.origin) return AFTER_SIGN_IN_PATH;

    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;

    // Check 2. Exactly one leading slash, or the browser resolves the result as
    // `//host` and leaves the origin we just verified.
    if (!path.startsWith("/") || path.startsWith("//")) return AFTER_SIGN_IN_PATH;

    return path;
  } catch {
    // `next` was unparseable even against a base, or `origin` was not a URL.
    return AFTER_SIGN_IN_PATH;
  }
}
