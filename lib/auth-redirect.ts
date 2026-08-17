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
 * that string by an email or an OAuth provider rather than by our own code. Only an
 * in-app path is allowed: an absolute URL would turn either route into an open
 * redirect, and `//host` counts as absolute to a browser even though it looks
 * relative.
 *
 * Anything that fails the test falls back to the workspace rather than erroring —
 * the user completed their part correctly, and a tampered `next` is not their
 * problem to read about.
 */
export function safeNextPath(next: string | null): string {
  if (!next) return AFTER_SIGN_IN_PATH;

  return next.startsWith("/") && !next.startsWith("//")
    ? next
    : AFTER_SIGN_IN_PATH;
}
