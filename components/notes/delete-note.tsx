"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { deleteNoteAction } from "@/app/notes/actions";
import { Button } from "@/components/ui/button";

/**
 * Deletes the open note, behind a confirm step.
 *
 * The two-state button follows `NewCollection` — reveal the real controls in
 * place rather than pull in a dialog primitive for one question. `window.confirm`
 * would also do the job, but it cannot be styled, cannot be tested, and reads as
 * a browser artefact rather than part of the app.
 *
 * There is no undo, which is why the warning names archiving: that is the
 * reversible option, and most people reaching for Delete actually want it.
 */
export function DeleteNote({
  noteId,
  title,
}: {
  noteId: string;
  title: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function remove() {
    setError(null);

    startTransition(async () => {
      const result = await deleteNoteAction(noteId);

      if (result.error) {
        setError(result.error);
        setConfirming(false);
        return;
      }

      // Back to the workspace — this note's route no longer resolves to anything.
      // Deliberately not clearing `pending`: the component is on its way out.
      router.push("/notes");
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={16} className="mr-1" aria-hidden />
          Delete note
        </Button>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
      <p className="text-sm">
        Delete <strong>{title || "this untitled note"}</strong> for good? This
        cannot be undone — archive it instead if you might want it back.
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={remove}
          disabled={pending}
        >
          {pending ? "Deleting…" : "Delete"}
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
