import { NoteSkeleton } from "@/components/notes/note-skeleton";

/**
 * Shown while a note route renders on the server.
 *
 * The page has its own Suspense boundary already, which covers streaming *this*
 * route once it has started rendering. This file covers the step before that: a
 * dynamic route without a `loading.tsx` is not prefetched, so clicking a note in
 * the sidebar waits on the server with nothing on screen. With it, Next.js
 * navigates immediately and streams into this fallback.
 *
 * Same skeleton either way, so the two paths are indistinguishable.
 */
export default function Loading() {
  return <NoteSkeleton />;
}
