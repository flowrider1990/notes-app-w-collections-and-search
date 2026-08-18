"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { createNoteAction } from "@/app/notes/actions";
import { Button } from "@/components/ui/button";

/**
 * Creates an empty note and opens it.
 *
 * No name prompt, unlike `NewCollection`: a collection is only a name, so asking
 * for one up front is the whole interaction, whereas a note's title is just the
 * first thing you type in the editor. The new note lands uncollected, which the
 * sidebar's "Uncollected" group shows expanded by default.
 *
 * Lives in the sidebar header rather than in the scrolling list, so it stays put
 * once the list is long enough to scroll.
 */
export function NewNote() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function create() {
    setError(null);

    startTransition(async () => {
      const result = await createNoteAction(null);

      if (result.error || !result.id) {
        setError(result.error ?? "Could not create the note.");
        return;
      }

      // Straight into the editor. The action already revalidated the workspace,
      // so the sidebar lists the new note by the time this navigation lands.
      router.push(`/notes/${result.id}`);
    });
  }

  return (
    // Sits in the sidebar header, so it is sized to its label rather than
    // stretched: the header is a row, not a stack of full-width controls.
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" onClick={create} disabled={pending}>
        <Plus size={16} className="mr-1" aria-hidden />
        {pending ? "Creating…" : "New note"}
      </Button>

      {error ? (
        <p role="alert" className="text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
