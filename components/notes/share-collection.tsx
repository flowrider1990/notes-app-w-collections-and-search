"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, Share2, Unlink } from "lucide-react";

import {
  getCollectionShareTokenAction,
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
  /**
   * Whether a share link exists — not the token, which would otherwise be
   * serialised into every `/notes` response for every collection. The token is
   * fetched when the menu opens; see the `Collection` type in lib/db.
   */
  isShared: boolean;
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
  isShared,
}: ShareCollectionProps) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * The token, once it has been asked for. Held here rather than in props because
   * the list this component is rendered from deliberately does not carry it.
   *
   * Re-read every time the menu opens rather than cached after the first: sharing
   * again issues a fresh token and revokes the old one, so a token kept from an
   * earlier open could offer a link that has already stopped working. This is not
   * held in `useTransition`'s `pending`, which gates the trigger button — a
   * disabled trigger while its own menu is open fights the menu.
   */
  const [token, setToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);

  /**
   * `window` does not exist while this renders on the server, so the origin is
   * filled in after mount. Until then there is no absolute URL worth showing —
   * a relative one would be useless to copy.
   */
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const url = token && origin ? `${origin}/share/${token}` : null;

  /**
   * Fetches the token when the menu opens on a shared collection. A collection that
   * is not shared has nothing to fetch, and any token still in state belongs to a
   * link that was revoked, so it is dropped.
   */
  function onOpenChange(open: boolean) {
    if (!open) return;

    setError(null);

    if (!isShared) {
      setToken(null);
      return;
    }

    // Dropped *before* the refetch rather than when it resolves. A token held from
    // an earlier open may have been rotated or revoked since, and leaving it on
    // screen — copyable, because `url` is still set — for the length of the round
    // trip is the dead link this refetch exists to avoid.
    setToken(null);
    setLoadingToken(true);

    void getCollectionShareTokenAction(collectionId)
      .then((result) => {
        if (result.error) setError(result.error);
        else setToken(result.token);
      })
      .catch(() => {
        // The action returns `{ error }` rather than throwing, so reaching here
        // means the request itself never landed — offline, a 500, a stale
        // deployment id. Without this the menu sits on "Loading link…" for good
        // and the rejection is swallowed, because nothing awaits this promise.
        setError("Could not load the share link.");
      })
      .finally(() => setLoadingToken(false));
  }

  function share() {
    setError(null);
    startTransition(async () => {
      const result = await shareCollectionAction(collectionId);
      if (result.error) setError(result.error);
      // The action already returns the new token, so the link can be shown without
      // a second round trip for the value that was just created.
      else setToken(result.token);
    });
  }

  function unshare() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await unshareCollectionAction(collectionId);
      if (result.error) setError(result.error);
      else setToken(null);
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
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={`Share collection ${name}`}
          className={cn(
            "row-control",
            // A shared collection keeps its control visible: it is the only marker
            // that the collection is readable by anyone with the link.
            isShared && "row-control-always text-primary",
          )}
        >
          <Share2 size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        {isShared ? (
          <>
            <div className="px-2 py-1.5">
              <p className="text-xs font-semibold">Anyone with this link</p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {loadingToken ? "Loading link…" : (url ?? "…")}
              </p>
            </div>

            <DropdownMenuItem
              // Disabled until the token has arrived: it used to come in as a prop
              // and was always there, so without this the item looks live during
              // the fetch and silently copies nothing. `loadingToken` is checked
              // too, so a refetch cannot copy the token it is replacing.
              disabled={!url || loadingToken}
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
