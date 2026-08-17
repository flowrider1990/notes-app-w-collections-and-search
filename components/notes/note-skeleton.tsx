import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * Stands in for the note detail page while the note loads.
 *
 * Mirrors `app/notes/[id]/page.tsx`: title, body, then the collection and tag
 * controls, then the save row. Rendered from two places — that page's Suspense
 * fallback and `app/notes/[id]/loading.tsx` — so navigating between notes and
 * loading one directly look the same.
 */
export function NoteSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex max-w-2xl flex-col gap-8">
      <span className="sr-only">Loading note…</span>

      <div className="flex flex-col gap-4">
        {/* Title, at the height of the 3xl heading it replaces. */}
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="min-h-[45vh] w-full" />
      </div>

      <hr />

      <div className="flex flex-col gap-2">
        <SectionLabel>Collection</SectionLabel>
        {/* max-w-sm, matching the real picker and the tag row below it. */}
        <Skeleton className="h-8 w-full max-w-sm" />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Tags</SectionLabel>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-full max-w-xs" />
          <Skeleton className="h-8 w-14" />
        </div>
      </div>

      {/* Save button and its status line. */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}
