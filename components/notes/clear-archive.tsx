"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { clearArchiveAction } from "@/app/notes/actions";
import { Button } from "@/components/ui/button";

/**
 * Deletes every archived note at once, from inside the Archive group.
 *
 * Two states rather than a dialog, like `DeleteNote` and `NewCollection`: the button
 * becomes the confirmation in place. No dialog primitive is installed and one
 * question does not warrant adding one.
 *
 * The confirmation names the real total, which matters here more than elsewhere. A
 * search or tag filter narrows what the Archive *lists*, but this deletes everything
 * archived — so the count comes from the unfiltered set and the sentence says the
 * number out loud rather than letting the visible cards imply it.
 */
export function ClearArchive({ count }: { count: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function clear() {
    setError(null);
    setNote(null);

    startTransition(async () => {
      const result = await clearArchiveAction();

      if (result.error) {
        setError(result.error);
        setConfirming(false);
        return;
      }

      // On success this component unmounts with the Archive group — the sidebar only
      // renders that group while something is archived — so there is nothing to
      // report and nowhere to report it. Zero is the exception: another tab got there
      // first, the group stays gone either way, and saying so beats a silent no-op if
      // the render happens to land before the revalidation.
      if (result.deleted === 0) {
        setNote("The archive was already empty.");
      }

      setConfirming(false);
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={14} className="mr-1" aria-hidden />
          Clear archive
        </Button>

        {error ? (
          <p role="alert" className="px-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {note ? (
          <p role="status" className="px-1 text-xs text-muted-foreground">
            {note}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2">
      <p className="text-xs">
        Delete{" "}
        <strong>
          {count === 1 ? "the 1 archived note" : `all ${count} archived notes`}
        </strong>{" "}
        for good? This cannot be undone, and it deletes everything in the archive —
        not only what is listed here.
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={clear}
          disabled={pending}
        >
          {pending ? "Deleting…" : `Delete ${count}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
