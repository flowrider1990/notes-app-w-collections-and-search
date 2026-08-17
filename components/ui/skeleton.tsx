import { cn } from "@/lib/utils";

/**
 * A grey placeholder block, sized by the caller to match whatever it stands in
 * for. Used to reserve the shape of content that is still loading, so nothing
 * moves when the real thing arrives.
 *
 * `motion-reduce:animate-none` because a page of pulsing blocks is exactly what
 * `prefers-reduced-motion` exists to stop — and the shapes do their job standing
 * still.
 *
 * Decorative by definition, so it is hidden from assistive technology. The
 * component that composes these is responsible for announcing that something is
 * loading, once, rather than one announcement per block.
 */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        // A tint of the foreground rather than `bg-muted`, so the blocks keep the
        // same contrast on the paper-white main pane and on the tinted sidebar —
        // muted-on-muted would all but disappear.
        "animate-pulse rounded-md bg-foreground/[0.08] motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
