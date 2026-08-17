import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * "← Back" navigation.
 *
 * A real link to a known page rather than a `history.back()` button: a share link
 * or a bookmark can be the first entry in a tab, where going back does nothing at
 * all. This always leads somewhere.
 */
export function BackLink({
  href = "/",
  label = "Back",
  className,
}: {
  href?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline",
        className,
      )}
    >
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  );
}
