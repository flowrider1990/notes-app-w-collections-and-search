import { Suspense } from "react";

import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
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

export default function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh w-full">
      {/* Sticky and a viewport tall, so the account controls sit at the bottom of
          the screen rather than the bottom of the document — a long note in the
          editor would otherwise push them out of sight. The middle section takes
          the scrolling instead of the whole column.

          No link back to the landing page: it redirects a signed-in visitor here,
          so the trip would end where it started. */}
      {/* Tinted a shade off the paper so the two panes read as separate surfaces
          without a heavy divider. Header and footer are both h-14, which gives the
          column a fixed frame and lets the list between them scroll on its own. */}
      <aside className="sticky top-0 flex h-svh w-80 shrink-0 flex-col border-r bg-muted/40">
        <header className="flex h-14 shrink-0 items-center border-b px-5">
          <p className="font-semibold tracking-tight">Notes</p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <Suspense fallback={<WorkspaceSkeleton />}>
            <Workspace />
          </Suspense>
        </div>

        <footer className="flex h-14 shrink-0 items-center justify-between border-t px-3">
          <ThemeSwitcher />
          <LogoutButton />
        </footer>
      </aside>

      <main className="flex-1 px-6 py-10 md:px-10 md:py-14">{children}</main>
    </div>
  );
}
