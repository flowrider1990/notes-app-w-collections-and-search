import type { NextConfig } from "next";

/**
 * Image attachments are read through signed Storage URLs, which live on the
 * project's own Supabase host. `next/image` refuses remote hosts it has not been
 * told about, so the hostname comes out of the same environment variable the
 * Supabase clients use — hardcoding the project ref here would break the moment the
 * project changes.
 */
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  // Failing here beats falling back to an empty allow-list: that would build fine
  // and then serve a 400 for every thumbnail, with nothing in the output to say why.
  // The app cannot run without this variable anyway — see "Running it" in CLAUDE.md.
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL is not set, so next/image cannot be told which host serves note images. Add it to .env.local.",
  );
}

const supabaseHostname = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;

/**
 * The Content-Security-Policy, assembled here because two of its sources are not
 * knowable ahead of time: the Supabase origin comes from the environment like the
 * image host above, and the dev server needs allowances production must not have.
 *
 * `script-src` carries `'unsafe-inline'`, which is the honest limit of this policy:
 * a served page holds nine or more inline scripts — the RSC flight payload, the Next
 * runtime, the theme script that runs before first paint — and their content differs
 * per page, so hashes cannot cover them. The alternative is a per-request nonce, and
 * Next can only inject one while rendering dynamically: static pages are built before
 * any request exists. `/`, `/auth/login` and the rest of the auth routes prerender,
 * so a nonce would make every one of them dynamic. That is a real cost to pay for a
 * directive that would still sit next to `style-src 'unsafe-inline'`, which Radix and
 * next-themes require by injecting `<style>` elements at runtime. So the value here is
 * in the other directives: `connect-src` bounds where anything can be sent, and
 * `object-src`, `base-uri`, `form-action` and `frame-ancestors` close the injection
 * routes that do not need a script at all.
 *
 * `img-src` needs no Supabase origin: `next/image` fetches signed Storage URLs
 * server-side and re-serves them from `/_next/image`, so the browser only ever asks
 * this origin. `connect-src` does need it, but only for Auth: rule 3 keeps every
 * query behind `server-only`, so `lib/db/auth-browser.ts` is the one module that
 * talks to Supabase from the browser at all. There is no `wss:`; nothing here
 * subscribes to Realtime.
 */
const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  // React uses `eval` in development to rebuild server error stacks, and the dev
  // server pushes updates over a websocket. Neither is true of a production build.
  // The `ws:` below assumes the plain-http dev server; `next dev --experimental-https`
  // would negotiate `wss:` and need it added.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  // `next/font/google` downloads Geist at build time and serves it from
  // `/_next/static/media`, so no Google origin is involved at runtime.
  "font-src 'self'",
  `connect-src 'self' https://${supabaseHostname}${isDev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  // Local development is served over plain http, so this one is production-only.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/**",
      },
    ],
  },

  /**
   * Response headers that apply to every route. The `*` modifier makes the parameter
   * zero-or-more, so `/:path*` matches the top-level `/` as well as everything under
   * it — the built regex in `.next/routes-manifest.json` is the place to confirm that
   * if this pattern is ever changed.
   */
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Without this a browser may sniff a response into a type the server never
          // declared. It covers what this origin serves, which for a user-uploaded
          // attachment means the `/_next/image` response rather than the signed
          // Storage URL behind it — rendering one with `unoptimized` or a plain `<img>`
          // would take it back out of scope. `nosniff` is the only valid value.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Nothing here frames itself, so the stricter `DENY` costs nothing over
          // `SAMEORIGIN` — there is no iframe in the app, and no flow needs one:
          // OAuth is a full-page redirect. `frame-ancestors 'none'` below supersedes
          // this header in modern browsers; it stays for the ones that predate CSP,
          // where it is the only thing saying no.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },

  experimental: {
    serverActions: {
      // The bucket caps a file at 5 MiB; this is the whole multipart request, so it
      // needs room for the boundaries and part headers on top of the file itself.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
