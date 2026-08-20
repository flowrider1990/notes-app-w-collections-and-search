import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

/**
 * What `metadataBase` resolves against is what a link preview will try to fetch, so
 * it has to be an address a stranger can reach. `VERCEL_URL` is not: it is the
 * generated per-deployment hostname, which answers every request with a redirect to
 * Vercel's sign-in, so every og:image the app advertised was a 302 to a login page and
 * no preview ever rendered one. `VERCEL_PROJECT_PRODUCTION_URL` is the production
 * alias — the one public address — and it is set on preview builds too, which is what
 * we want: a preview should point its images at the copy people can actually load.
 * The `VERCEL_URL` fallback keeps the old behaviour if the newer variable is ever
 * absent, rather than silently falling through to localhost.
 */
const productionUrl =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

const defaultUrl = productionUrl
  ? `https://${productionUrl}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Notes",
  description:
    "A personal notes workspace: collections, tags, and full-text search.",
};

/**
 * Two faces, two jobs. Geist Sans carries everything the user wrote; Geist Mono
 * carries everything the app says about it — section labels, counts, save status.
 * The interface is instrumentation around a page of prose, and the type says so
 * without spending any colour on the distinction.
 */
const geistSans = Geist({
  variable: "--font-sans",
  display: "swap",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
