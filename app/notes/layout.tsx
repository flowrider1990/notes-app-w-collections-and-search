import { Suspense } from "react";

import { WorkspaceShell } from "@/components/notes/workspace-shell";
import { WorkspaceSidebar } from "@/components/notes/workspace-sidebar";
import { WorkspaceSkeleton } from "@/components/notes/workspace-skeleton";
import {
  getCollections,
  getNotes,
  getSearchHistory,
  getTags,
} from "@/lib/db";
import { requireUser } from "@/lib/db/auth";

/**
 * Loads the whole workspace in one place. Tag filtering still runs in the client
 * over this set; full-text search does not, and goes to the database — layouts are
 * not given `searchParams`, so the sidebar asks for results through a Server
 * Action instead of this fetch reacting to a URL.
 *
 * Sits inside the layout's Suspense boundary because it reads `cookies()` for
 * the session: with `cacheComponents` enabled, doing that outside a boundary
 * fails the build rather than merely slowing the route down.
 */
async function Workspace() {
  await requireUser();

  const [notes, collections, tags, searchHistory] = await Promise.all([
    getNotes(),
    getCollections(),
    getTags(),
    getSearchHistory(),
  ]);

  return (
    <WorkspaceSidebar
      notes={notes}
      collections={collections}
      tags={tags}
      searchHistory={searchHistory}
    />
  );
}

/**
 * The frame lives in `WorkspaceShell`, which is a client component because the
 * sidebar collapses into a drawer below `md`. The streamed sidebar is handed to it
 * as a prop, so the Suspense boundary and every database read stay on the server.
 */
export default function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <WorkspaceShell
      sidebar={
        <Suspense fallback={<WorkspaceSkeleton />}>
          <Workspace />
        </Suspense>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
