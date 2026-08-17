import { Skeleton } from "@/components/ui/skeleton";

/**
 * Stands in for `WorkspaceSidebar` while the workspace loads.
 *
 * Mirrors that component's real order and sizes — search box, tag row, the two
 * create buttons, then collection groups holding note cards — because the whole
 * point is that nothing moves when the data lands. If the sidebar's layout
 * changes, this has to change with it or the swap will visibly jump.
 *
 * The headings are real text rather than blocks: they are already known, so
 * greying them out would be pretending to load something that is not loading.
 */
export function WorkspaceSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading workspace…</span>

      {/* Search box */}
      <Skeleton className="h-9 w-full" />

      {/* Tag filter */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Tags
        </p>
        <div className="flex flex-wrap gap-1">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-12 rounded-full" />
        </div>
      </div>

      {/* New note / New collection */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>

      {/* Two collection groups, the second holding cards like the expanded
          "Uncollected" group the real sidebar opens by default. */}
      <div className="flex flex-col gap-2">
        <CollectionGroupSkeleton />
        <CollectionGroupSkeleton cards={2} />
      </div>
    </div>
  );
}

/** One collapsed collection header, optionally with note cards beneath it. */
function CollectionGroupSkeleton({ cards = 0 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-4" />
      </div>

      {cards > 0 ? (
        <div className="flex flex-col gap-2 pl-2">
          {Array.from({ length: cards }, (_, index) => (
            // Height matches a NoteCard with a title and a two-line excerpt.
            <Skeleton key={index} className="h-[76px] w-full" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
