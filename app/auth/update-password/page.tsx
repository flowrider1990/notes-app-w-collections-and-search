import { Suspense } from "react";

import { UpdatePasswordForm } from "@/components/update-password-form";
import { requireUser } from "@/lib/db/auth";

/**
 * Gates the page on the session the recovery link established.
 *
 * This is a signed-in-only page like any other — rule 6 applies — even though it
 * lives under `/auth`. `updateUser` changes the password of whoever is signed in, so
 * without a session there is nothing here to act on. Checking up front means an
 * expired or already-used link redirects to sign-in, instead of presenting a form
 * whose submit was always going to fail.
 *
 * Inside a Suspense boundary because it reads cookies: with `cacheComponents` on,
 * doing that outside one fails the build.
 */
async function Gate() {
  await requireUser();
  return <UpdatePasswordForm />;
}

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense
          fallback={
            <p className="text-center text-sm text-muted-foreground">
              Checking your link…
            </p>
          }
        >
          <Gate />
        </Suspense>
      </div>
    </div>
  );
}
