import { AFTER_SIGN_IN_PATH } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/client";

/**
 * The sign-in calls that have to run in the browser, kept out of the components
 * that trigger them for the same reason as `lib/db/index.ts`: nothing in
 * `components/` creates a Supabase client or handles a raw `{ data, error }`.
 *
 * This is the browser half of the auth helper. The server half is `./auth.ts`,
 * which cannot be merged into this file: it imports the cookie-backed server
 * client, and importing that from a Client Component breaks the build.
 *
 * supabase-js reports failures in `error` rather than throwing, so each function
 * checks it once and throws a message the form can show as-is.
 */

/**
 * Ends the session: revokes it with the Auth server and clears the auth cookies,
 * so the next server render sees no user.
 */
export async function signOut(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(`Could not sign out: ${error.message}`);
  }
}

/** Signs in with email and password. Throws if the credentials are rejected. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Creates an account and asks Supabase to send a confirmation email.
 *
 * The link in that email must land on `/auth/confirm`, not on the workspace. The
 * email carries a `token_hash` that only means something to `verifyOtp`, and that
 * call lives in the confirm route handler — point the link straight at `/notes`
 * and the visitor arrives with no session at all, confirmed but signed out, and
 * gets bounced to the login page.
 */
export async function signUp(email: string, password: string): Promise<void> {
  const supabase = createClient();

  const confirm = new URL("/auth/confirm", window.location.origin);
  confirm.searchParams.set("next", AFTER_SIGN_IN_PATH);

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: confirm.toString() },
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Hands the browser to Google's consent screen, asking Supabase to send the user
 * back to `/auth/callback` afterwards.
 *
 * The browser client runs the PKCE flow, so it stores a code verifier in a cookie
 * before leaving; `/auth/callback` reads that cookie to finish the exchange. That
 * is why the destination is a route handler and not a page.
 *
 * On success this function does not return normally — supabase-js navigates away
 * itself — so callers should leave their pending state set and only clear it when
 * this throws.
 */
export async function signInWithGoogle(): Promise<void> {
  const supabase = createClient();

  // Built from the live origin so the same code works on whatever port the dev
  // server picked. The path must be in the project's redirect allow list.
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("next", AFTER_SIGN_IN_PATH);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });

  if (error) {
    throw new Error(`Could not start Google sign-in: ${error.message}`);
  }
}
