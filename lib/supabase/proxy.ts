import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isSharePath } from "../share-path";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  /**
   * A redirect that carries over whatever cookies the Supabase client just wrote.
   *
   * `getClaims()` refreshes a session that is close to expiring, and those new
   * cookies live on `supabaseResponse`. Returning a bare `NextResponse.redirect`
   * would drop them and sign the user out at random — the exact failure the notes
   * at the end of this function warn about.
   */
  function redirectTo(pathname: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;

    const response = NextResponse.redirect(url);
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => response.cookies.set(cookie));

    return response;
  }

  // A signed-in visitor has no use for the landing page — it exists to offer a way
  // in, and they are already in. Redirecting here keeps `/` free of any session
  // read, so it stays a fully static page.
  //
  // `getClaims()` is enough for this one decision because nothing is being
  // protected: a forged token would land on `/notes`, where `requireUser()` asks
  // the Auth server and turns it away. See rule 6 in CLAUDE.md.
  if (user && request.nextUrl.pathname === "/") {
    return redirectTo("/notes");
  }

  if (
    request.nextUrl.pathname !== "/" &&
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    // Share links are meant to work without a session. Without this the recipient
    // is redirected to the login page and the whole feature is unreachable. The
    // route itself is still gated: it reads through the token-scoped
    // `shared_collection` function, so an unknown token renders a 404.
    !isSharePath(request.nextUrl.pathname)
  ) {
    // no user, potentially respond by redirecting the user to the login page
    return redirectTo("/auth/login");
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
