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

  experimental: {
    serverActions: {
      // The bucket caps a file at 5 MiB; this is the whole multipart request, so it
      // needs room for the boundaries and part headers on top of the file itself.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
