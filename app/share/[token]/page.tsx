import { Suspense } from "react";
import { notFound } from "next/navigation";

import { SharedCollectionSkeleton } from "@/components/notes/shared-collection-skeleton";
import { getSharedCollection } from "@/lib/db";

type SharePageProps = {
  params: Promise<{ token: string }>;
};

/**
 * A shared collection, readable without signing in.
 *
 * Deliberately **not** under `app/notes/` — that layout calls `requireUser()` and
 * would redirect a visitor who has no session. This route also depends on `/share`
 * being allowlisted in `lib/supabase/proxy.ts`; without that the middleware sends
 * every recipient to the login page before this code ever runs.
 *
 * Read-only by construction: no pin, archive, drag, tag or collection controls, and
 * the data comes from a function that returns nothing but names and text.
 */
async function SharedCollection({ params }: SharePageProps) {
  const { token } = await params;

  const shared = await getSharedCollection(token);

  // An unknown token and a revoked one are the same thing here, and both should
  // read as "not found" rather than hinting that the link was once valid.
  if (!shared) notFound();

  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1 border-b pb-4">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Shared collection
        </p>
        <h1 className="text-2xl font-bold">{shared.name}</h1>
        <p className="text-sm text-muted-foreground">
          {shared.notes.length === 1
            ? "1 note"
            : `${shared.notes.length} notes`}
        </p>
      </header>

      {shared.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This collection has no notes to show.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {shared.notes.map((note) => (
            <section key={note.id} className="rounded-md border p-4">
              <h2 className="font-medium">{note.title || "(untitled)"}</h2>
              {note.body ? (
                <p className="mt-2 whitespace-pre-wrap text-sm">{note.body}</p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  This note has no body.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * `params` is per-request data, so awaiting it has to happen inside the Suspense
 * boundary — the promise is handed to the child rather than unwrapped here, or
 * `cacheComponents` would refuse to prerender the route.
 */
export default function SharePage({ params }: SharePageProps) {
  return (
    <Suspense fallback={<SharedCollectionSkeleton />}>
      <SharedCollection params={params} />
    </Suspense>
  );
}
