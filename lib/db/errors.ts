/**
 * Which of the data layer's errors a Server Action may repeat back to the browser.
 *
 * `supabase-js` puts Postgres's own words in `error.message` — table names, policy
 * names, constraint names, SQLSTATE text — and `lib/db/` interpolates them into the
 * errors it throws, deliberately, so that whoever reads a server log can see what
 * actually failed. A Server Action's *return value* is not redacted the way a throw
 * from a server component is, so passing those messages straight through published
 * them to anyone able to call the action: `addTagToNoteAction` on a foreign id
 * answered `new row violates row-level security policy for table "note_tags"`.
 *
 * The split is by intent rather than by wording. A message is user-facing because
 * it was written for the person using the app — "You already have a collection
 * called Work", "Images must be 5 MB or smaller" — and those have to survive,
 * since they are the whole reason these actions return a string instead of
 * throwing. Everything else is diagnostic and the caller gets the action's own
 * fallback sentence instead.
 *
 * This module is deliberately free of `server-only` and of any Supabase import, so
 * the rule can be unit-tested without standing up a client.
 */

/**
 * An error whose message was written for the user and is safe to show them.
 *
 * Carries no extra data: the type *is* the signal. Throw it for a message you would
 * be willing to see in a screenshot, and a plain `Error` for anything that quotes
 * the database.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * The message a Server Action may return for `cause`.
 *
 * Fails closed. Anything that is not a `UserFacingError` collapses to `fallback` —
 * a plain `Error`, a thrown string, `undefined`, an object with a `message`
 * property — so a throw added to `lib/db/` later is private by default rather than
 * public until somebody notices it. An empty or blank message falls back too,
 * because "" would render as no error at all while still meaning failure.
 */
export function clientErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof UserFacingError && cause.message.trim() !== "") {
    return cause.message;
  }

  return fallback;
}
