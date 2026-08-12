import type { ReactNode } from "react";

import { badgeVariants } from "@/components/ui/badge";
import type { Tag } from "@/lib/db";
import { tagDotClasses, tagPillClasses } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

type TagPillProps = {
  tag: Tag;
  /** Draws a ring for the filter panel's active state, keeping the tag's colour. */
  selected?: boolean;
  className?: string;
  /** Slot for a trailing control, such as the tag editor's remove button. */
  children?: ReactNode;
};

/**
 * A tag rendered with its persisted palette colour, used on note cards, in the
 * sidebar filter panel and in the tag editor so one tag looks the same everywhere.
 *
 * Reuses `badgeVariants` for the shared shape but renders a `<span>` rather than
 * using `Badge` directly: `Badge` is a `<div>`, and the filter panel puts these
 * inside a `<button>`, where flow content is not valid. `cn` runs tailwind-merge,
 * so the palette classes win over the variant's defaults.
 */
export function TagPill({
  tag,
  selected = false,
  className,
  children,
}: TagPillProps) {
  return (
    <span
      className={cn(
        badgeVariants({ variant: "outline" }),
        tagPillClasses(tag.color),
        selected && "ring-2 ring-ring ring-offset-1",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("mr-1 h-2 w-2 shrink-0 rounded-full", tagDotClasses(tag.color))}
      />
      {tag.name}
      {children}
    </span>
  );
}
