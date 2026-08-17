import { cn } from "@/lib/utils";

/**
 * The small label above a group of controls — COLLECTION, TAGS, SHARED COLLECTION.
 *
 * Set in mono, uppercase, with wide tracking. That is the one typographic idea in
 * this interface: what the user wrote is sans, what the app says *about* it is
 * mono. The distinction costs no colour and no border, and it means a label can
 * never be mistaken for content.
 *
 * Defined once so the labels cannot drift apart — there are five of them across
 * the workspace, the share page and the loading skeletons.
 */
export function SectionLabel({
  children,
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}
