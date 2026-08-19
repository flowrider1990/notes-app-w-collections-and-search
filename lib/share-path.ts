/**
 * Whether a path belongs to the share namespace.
 *
 * `/share/**` is the one part of the app a signed-out visitor may reach, so
 * `lib/supabase/proxy.ts` exempts it from the redirect to the login page. That
 * exemption is what makes share links work at all, and it is also the only
 * anonymous read path in the project — which is why it is matched by segment
 * rather than by prefix.
 *
 * `startsWith("/share")` would also match `/shared-admin` and `/sharexyz`. Neither
 * route exists, so nothing was reachable through it, but the exemption would widen
 * silently the moment one was added, and the widening would not look like a change
 * to auth. A segment test cannot widen by accident.
 *
 * It lives in its own module rather than in `proxy.ts` because that file imports
 * `next/server`, which does not resolve outside Next's bundler — this way the rule
 * is covered by `lib/share-path.test.ts`.
 */
export function isSharePath(pathname: string): boolean {
  return pathname === "/share" || pathname.startsWith("/share/");
}
