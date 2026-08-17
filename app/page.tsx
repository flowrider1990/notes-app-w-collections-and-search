import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The landing page: what this app is, and the way in. Nothing else.
 *
 * Only ever seen without a session — `lib/supabase/proxy.ts` sends a signed-in
 * visitor to the workspace before this renders. That redirect lives there rather
 * than here on purpose: this page reads no cookies, so it stays fully static, and
 * a check in the page body would fire after the shell had already streamed.
 */
export default function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-12 text-center">
        <div className="flex flex-col gap-4">
          <h1 className="text-5xl font-semibold tracking-[-0.03em]">Notes</h1>
          <p className="text-balance text-[15px] leading-7 text-muted-foreground">
            A personal workspace for everything you write down. Group notes into
            collections, colour-code them with tags, and search the full text of
            every note at once.
          </p>
        </div>

        <div className="flex w-full flex-col gap-4">
          <Button asChild size="lg" className="w-full text-base">
            <Link href="/auth/login">Sign in</Link>
          </Button>

          <p className="text-sm text-muted-foreground">
            No account yet?{" "}
            <Link
              href="/auth/sign-up"
              className="underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
