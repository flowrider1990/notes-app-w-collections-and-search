"use client";

import { useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Pin } from "lucide-react";

import { setNoteArchivedAction, setNotePinnedAction } from "@/app/notes/actions";
import { TagPill } from "@/components/notes/tag-pill";
import { cn } from "@/lib/utils";
import type { Note } from "@/lib/db";
import { NOTE_COLLECTION_MIME, NOTE_ID_MIME } from "@/lib/dnd";

/**
 * A note as it appears in the sidebar: title, body excerpt, tags, and controls
 * for pinning and archiving. Also the drag source for moving a note between
 * collections without opening it.
 *
 * The card is a `<div>` wrapping a `<Link>` rather than being one big `<Link>`:
 * a `<button>` inside an anchor is invalid markup, and clicking it would mutate
 * *and* navigate. Same reason the collection header is a flex row rather than a
 * single button.
 *
 * The wrapper owns the drag. `dragstart` fires on whichever element the browser
 * chooses as the source — usually the inner anchor, since links are draggable by
 * default — and bubbles here, so one handler covers every case.
 */
export function NoteCard({ note }: { note: Note }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData(NOTE_ID_MIME, note.id);
    // Empty string for an uncollected note: `dataTransfer` carries strings only,
    // so there is no way to express null.
    event.dataTransfer.setData(NOTE_COLLECTION_MIME, note.collection_id ?? "");
    event.dataTransfer.effectAllowed = "move";
  }

  function togglePinned() {
    setError(null);
    startTransition(async () => {
      const result = await setNotePinnedAction(note.id, !note.pinned);
      if (result.error) setError(result.error);
    });
  }

  function toggleArchived() {
    setError(null);
    startTransition(async () => {
      const result = await setNoteArchivedAction(note.id, !note.archived);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div
      // Archived notes are not draggable. Dropping one on a collection did move it,
      // but `archived` stayed set, so it never appeared in the group it was dropped
      // on — the drag succeeded and looked like it had failed. This mirrors the
      // Archive section's own `droppable={false}`: restore the note first, then move
      // it. A non-draggable card gives no drag ghost at all, which reads as "not
      // this" rather than as a silent no-op.
      draggable={!note.archived}
      onDragStart={note.archived ? undefined : onDragStart}
      className="group rounded-lg border bg-card p-3.5 transition-colors duration-150 hover:border-foreground/15 hover:bg-accent"
    >
      <div className="flex items-start gap-1">
        <Link href={`/notes/${note.id}`} className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium tracking-tight">
            {note.title || "(untitled)"}
          </h3>

          {note.body ? (
            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {note.body}
            </p>
          ) : null}

          {note.tags.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {note.tags.map((tag) => (
                <TagPill key={tag.id} tag={tag} />
              ))}
            </div>
          ) : null}
        </Link>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={togglePinned}
            disabled={pending}
            aria-pressed={note.pinned}
            aria-label={`${note.pinned ? "Unpin" : "Pin"} ${note.title || "untitled note"}`}
            className={cn(
              "rounded p-1 transition-opacity hover:bg-background disabled:opacity-50",
              // A pinned note keeps its control visible: it is the only thing
              // marking the note as pinned, so hiding it until hover would hide
              // the state as well.
              note.pinned
                ? "opacity-100"
                : "opacity-0 focus:opacity-100 group-hover:opacity-100",
            )}
          >
            {/* A filled pin for pinned, an outline for not — the icon carries the
                state, since lucide has no separate "pinned" glyph. */}
            <Pin size={14} aria-hidden className={cn(note.pinned && "fill-current")} />
          </button>

          <button
            type="button"
            onClick={toggleArchived}
            disabled={pending}
            aria-label={`${note.archived ? "Restore" : "Archive"} ${note.title || "untitled note"}`}
            className="rounded p-1 opacity-0 transition-opacity hover:bg-background focus:opacity-100 disabled:opacity-50 group-hover:opacity-100"
          >
            {note.archived ? (
              <ArchiveRestore size={14} aria-hidden />
            ) : (
              <Archive size={14} aria-hidden />
            )}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
