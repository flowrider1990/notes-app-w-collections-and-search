import { Suspense } from "react";

import { WorkspaceSidebar } from "@/components/notes/workspace-sidebar";
import { getCollections, getNotes, getTags } from "@/lib/db";
import { requireUser } from "@/lib/db/auth";

/**
 * Loads the whole workspace in one place. The sidebar filters this set in the
 * client, so search and tag filtering never hit the database again.
 *
 * Sits inside the layout's Suspense boundary because it reads `cookies()` for
 * the session: with `cacheComponents` enabled, doing that outside a boundary
 * fails the build rather than merely slowing the route down.
 */
async function Workspace() {
  await requireUser();

  const [notes, collections, tags] = await Promise.all([
    getNotes(),
    getCollections(),
    getTags(),
  ]);

  return (
    <WorkspaceSidebar notes={notes} collections={collections} tags={tags} />
  );
}

export default function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh w-full">
      <aside className="w-80 shrink-0 overflow-y-auto border-r p-4">
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">Loading workspace…</p>
          }
        >
          <Workspace />
        </Suspense>
      </aside>

      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
