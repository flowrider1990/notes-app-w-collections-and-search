/**
 * Where a signed-in user lands: the workspace, which is the whole app.
 *
 * Every way in reads it from here — the email/password form pushes it after
 * `signInWithPassword`, the Google callback route redirects to it once the code
 * exchange succeeds, and sign-up hands it to Supabase as the confirmation link's
 * destination — so they cannot drift apart. Changing where people land is a
 * one-line edit in this file.
 */
export const AFTER_SIGN_IN_PATH = "/notes";
