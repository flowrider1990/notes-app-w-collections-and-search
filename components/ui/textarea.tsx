import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Multi-line counterpart to `Input`, sharing its border, focus ring and disabled
 * treatment so a form built from both does not look assembled from two kits.
 *
 * No height here on purpose: how tall a textarea should be depends entirely on what
 * it holds, so callers set it.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
