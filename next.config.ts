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
          // OAuth is a full-page redirect. This is the stopgap. CSP
          // `frame-ancestors 'none'` supersedes it in modern browsers and is the
          // real fix, but no page response here carries a CSP yet — only
          // `/_next/image`, from the optimizer's own default — and an unframed app
          // beats waiting for one.
          { key: "X-Frame-Options", value: "DENY" },
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
