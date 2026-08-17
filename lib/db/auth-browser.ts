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
 * Builds a URL for Supabase to send the user back to, with a destination attached.
 *
 * Always an absolute URL on the live origin, because Supabase is the one doing the
 * redirecting — and whatever this produces has to be in the project's redirect
 * allow list or the link quietly returns to the Site URL instead.
 */
function returnUrl(path: string, next: string): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("next", next);
  return url.toString();
}

/**
 * Creates an account and asks Supabase to send a confirmation email.
 *
 * Returns whether the account arrived already signed in. With "Confirm email"
 * enabled — which is how this project is meant to run — Supabase returns
 * `session === null`, meaning an email is on its way and the user is not in yet.
 * A session coming back instead means confirmations are switched off; the caller
 * uses that to avoid parking someone on a "check your email" page that will never
 * be satisfied.
 *
 * The link in that email lands on `/auth/confirm`, never on the workspace: it
 * carries a token that only `verifyOtp` or `exchangeCodeForSession` can turn into a
 * session, and both of those live in that route handler.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<{ signedIn: boolean }> {
  const supabase = createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: returnUrl("/auth/confirm", AFTER_SIGN_IN_PATH),
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return { signedIn: data.session !== null };
}

/**
 * Asks Supabase to email a password-reset link.
 *
 * Resolves the same way whether or not the address has an account — Supabase does
 * not say, and neither should the UI, or the form becomes a way to find out who has
 * registered.
 *
 * The link comes back to `/auth/confirm`, which turns the token into a session and
 * forwards to the update-password page. That page needs the session: changing a
 * password is `updateUser`, which acts on the signed-in user.
 */
export async function resetPasswordForEmail(email: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: returnUrl("/auth/confirm", "/auth/update-password"),
  });

  if (error) {
    throw new Error(`Could not send the reset email: ${error.message}`);
  }
}

/**
 * Sets a new password for the signed-in user.
 *
 * Reached with the session the recovery link established, so there is no old
 * password to supply — holding a working link from the account's own inbox is the
 * proof.
 */
export async function updatePassword(password: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    throw new Error(error.message);
  }
}

/** The social providers enabled on this project. */
export type OAuthProvider = "google" | "github";

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  github: "GitHub",
};

/**
 * Hands the browser to a provider's consent screen, asking Supabase to send the user
 * back to `/auth/callback` afterwards.
 *
 * One function for every provider rather than one per provider: the flow is
 * identical, and the only thing that differs is the name in the error message. Adding
 * the next one is a line in `OAuthProvider`.
 *
 * The browser client runs the PKCE flow, so it stores a code verifier in a cookie
 * before leaving; `/auth/callback` reads that cookie to finish the exchange. That is
 * why the destination is a route handler and not a page.
 *
 * On success this function does not return normally — supabase-js navigates away
 * itself — so callers should leave their pending state set and only clear it when
 * this throws.
 */
export async function signInWithProvider(
  provider: OAuthProvider,
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    // Built from the live origin so the same code works on whatever port the dev
    // server picked. It must be in the project's redirect allow list.
    options: { redirectTo: returnUrl("/auth/callback", AFTER_SIGN_IN_PATH) },
  });

  if (error) {
    throw new Error(
      `Could not start ${PROVIDER_LABELS[provider]} sign-in: ${error.message}`,
    );
  }
}
