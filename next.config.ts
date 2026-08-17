import type { NextConfig } from "next";

/**
 * Image attachments are read through signed Storage URLs, which live on the
 * project's own Supabase host. `next/image` refuses remote hosts it has not been
 * told about, so the hostname comes out of the same environment variable the
 * Supabase clients use — hardcoding the project ref here would break the moment the
 * project changes.
 */
const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  cacheComponents: true,

  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/**",
          },
        ]
      : [],
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
