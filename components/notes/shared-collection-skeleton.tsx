import { Skeleton } from "@/components/ui/skeleton";

/**
 * Stands in for a shared collection while it loads.
 *
 * Mirrors the article in `app/share/[token]/page.tsx`. This is the only page
 * someone without an account ever sees, so it is the one where a bare line of
 * grey text reads worst.
 *
 * "Shared collection" is real text: the page knows that much before the fetch
 * resolves, and it tells the visitor what they are waiting for.
 */
export function SharedCollectionSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto flex max-w-2xl flex-col gap-6 p-6"
    >
      <span className="sr-only">Loading shared collection…</span>

      <div className="flex flex-col gap-2 border-b pb-4">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Shared collection
        </p>
        {/* Collection name, then the note count line. */}
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-16" />
      </div>

      <div className="flex flex-col gap-4">
        {[0, 1].map((index) => (
          <div key={index} className="flex flex-col gap-2 rounded-md border p-4">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
