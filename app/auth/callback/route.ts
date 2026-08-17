import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Supabase returns the user after Google sign-in.
 *
 * The browser client started a PKCE flow and left its code verifier in a cookie,
 * so this handler can trade the `code` for a session. Doing it here rather than in
 * the browser is the point: the exchange writes the session cookies through the
 * server client, which is what makes the session visible to Server Components and
 * to `lib/supabase/proxy.ts` on the very next request.
 *
 * Failure handling mirrors `../confirm/route.ts` — `/auth/error` with the message,
 * never a blank screen.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Google's own refusals (a cancelled consent screen, a misconfigured client)
  // arrive here as `error`, not as an exchange failure further down.
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    redirect(`/auth/error?error=${encodeURIComponent(providerError)}`);
  }

  const code = searchParams.get("code");

  if (!code) {
    redirect(
      `/auth/error?error=${encodeURIComponent("No code in the sign-in callback")}`,
    );
  }

  const supabase = await createClient();

  // Present only when several PKCE flows overlap; without it the most recently
  // stored verifier is used, which is the normal single-tab case.
  const flowId = searchParams.get("sb_flow_id");

  const { error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );

  if (error) {
    redirect(`/auth/error?error=${encodeURIComponent(error.message)}`);
  }

  // Shared with `/auth/confirm`, which takes a destination from an email for the
  // same reason and needs the same open-redirect guard.
  redirect(safeNextPath(searchParams.get("next")));
}
