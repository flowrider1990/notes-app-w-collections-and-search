import { type User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Resolves the signed-in user, redirecting to the login page when there is none.
 * The single gate for every signed-in-only page — see rule 6 in CLAUDE.md.
 *
 * `getUser()` and not `getClaims()`: this project signs its tokens with an
 * asymmetric key (ES256), and against those `getClaims()` verifies locally from a
 * cached JWKS without ever contacting the Auth server. That proves the token was
 * issued by this project and has not expired — nothing more. A session that was
 * signed out or revoked, or whose user has been deleted, keeps passing that check
 * until the access token runs out. `getUser()` asks the Auth server and fails as
 * soon as the session stops being real, at the cost of one round trip per page.
 *
 * Pages need a gate at all because RLS makes an unauthenticated read
 * indistinguishable from an empty table: both come back as `[]` with
 * `error: null`. Redirecting turns that ambiguity into something the reader can
 * act on. It lives in `lib/db/` so no component has to import the Supabase client
 * itself.
 */
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/auth/login");
  }

  return data.user;
}
