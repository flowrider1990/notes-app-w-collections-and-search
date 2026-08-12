import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Resolves the signed-in user's claims, redirecting to the login page when
 * there is no session.
 *
 * Pages need this because RLS makes an unauthenticated read indistinguishable
 * from an empty table: both come back as `[]` with `error: null`. Redirecting
 * turns that ambiguity into something the reader can act on. It lives in
 * `lib/db/` so no component has to import the Supabase client itself.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return data.claims;
}
