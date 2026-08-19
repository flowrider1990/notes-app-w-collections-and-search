import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the links in Supabase's emails land — signup confirmation and password
 * recovery both come through here.
 *
 * It accepts **two shapes**, because which one arrives depends on the email template
 * configured in the project rather than on anything in this codebase:
 *
 * - `token_hash` + `type`, which the templates in Supabase's docs produce. Verified
 *   with `verifyOtp`. Nothing is stored client-side, so the link works from any
 *   browser or device.
 * - `code`, which the default `{{ .ConfirmationURL }}` template produces: Supabase
 *   verifies the token on its side and redirects here with an auth code. Exchanged
 *   with `exchangeCodeForSession`, the same call `/auth/callback` makes for OAuth.
 *
 * The `code` path has one limitation worth knowing before debugging it: PKCE keeps
 * its verifier in a cookie set when the email was requested, so the link only works
 * in the browser that asked for it. Opening a reset email on a phone fails with a
 * missing-verifier error. Pasting the documented `token_hash` templates into the
 * dashboard is what removes that constraint — and this route already handles them.
 *
 * Either way the session cookies are written server-side, so the very next request
 * sees a signed-in user.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  // Where to go once the session exists. Only ever an in-app path — this value
  // arrives from an email, not from our own code.
  const next = safeNextPath(searchParams.get("next"), origin);

  // Supabase forwards its own refusals — an expired or already-used link — as
  // `error`, which arrives instead of a token rather than alongside one.
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    redirect(`/auth/error?error=${encodeURIComponent(providerError)}`);
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  if (!tokenHash && !code) {
    redirect(
      `/auth/error?error=${encodeURIComponent("That link is missing its token. Request a new email.")}`,
    );
  }

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (error) {
      redirect(`/auth/error?error=${encodeURIComponent(error.message)}`);
    }

    redirect(next);
  }

  if (tokenHash && !type) {
    redirect(
      `/auth/error?error=${encodeURIComponent("That link is missing its type. Request a new email.")}`,
    );
  }

  // Only a `code` is left. Present only when several PKCE flows overlap; without it
  // the most recently stored verifier is used, which is the normal single-tab case.
  const flowId = searchParams.get("sb_flow_id");

  const { error } = await supabase.auth.exchangeCodeForSession(
    code as string,
    flowId ? { flowId } : undefined,
  );

  if (error) {
    redirect(`/auth/error?error=${encodeURIComponent(error.message)}`);
  }

  redirect(next);
}
