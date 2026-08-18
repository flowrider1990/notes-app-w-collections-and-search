"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, Share2, Unlink } from "lucide-react";

import {
  shareCollectionAction,
  unshareCollectionAction,
} from "@/app/notes/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ShareCollectionProps = {
  collectionId: string;
  name: string;
  /** Null when the collection is private. */
  shareToken: string | null;
};

/**
 * Creates, copies and revokes a collection's share link.
 *
 * Anyone holding the link can read the collection without signing in, through the
 * `shared_collection` database function — see section 6 of docs/schema.sql for why
 * that is a function and not an RLS policy.
 *
 * A dropdown rather than an inline panel: the collection header is already a
 * crowded flex row, and the link only matters at the moment it is being copied.
 */
export function ShareCollection({
  collectionId,
  name,
  shareToken,
}: ShareCollectionProps) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * `window` does not exist while this renders on the server, so the origin is
   * filled in after mount. Until then there is no absolute URL worth showing —
   * a relative one would be useless to copy.
   */
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const url = shareToken && origin ? `${origin}/share/${shareToken}` : null;

  function share() {
    setError(null);
    startTransition(async () => {
      const result = await shareCollectionAction(collectionId);
      if (result.error) setError(result.error);
    });
  }

  function unshare() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await unshareCollectionAction(collectionId);
      if (result.error) setError(result.error);
    });
  }

  async function copy() {
    if (!url) return;

    try {
      // Needs a secure context. localhost counts as one, but the call can still
      // be refused, so the rejection is surfaced instead of silently doing nothing.
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the link and copy it manually.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={`Share collection ${name}`}
          className={cn(
            "row-control",
            // A shared collection keeps its control visible: it is the only marker
            // that the collection is readable by anyone with the link.
            shareToken && "row-control-always text-primary",
          )}
        >
          <Share2 size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        {shareToken ? (
          <>
            <div className="px-2 py-1.5">
              <p className="text-xs font-semibold">Anyone with this link</p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {url ?? "…"}
              </p>
            </div>

            <DropdownMenuItem
              // Keeps the menu open, so the copied confirmation is visible.
              onSelect={(event) => {
                event.preventDefault();
                copy();
              }}
            >
              {copied ? (
                <Check size={14} className="mr-2" aria-hidden />
              ) : (
                <Copy size={14} className="mr-2" aria-hidden />
              )}
              {copied ? "Copied" : "Copy link"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={unshare} className="text-destructive">
              <Unlink size={14} className="mr-2" aria-hidden />
              Stop sharing
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={share}>
            <Share2 size={14} className="mr-2" aria-hidden />
            Create share link
          </DropdownMenuItem>
        )}

        {error ? (
          <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
