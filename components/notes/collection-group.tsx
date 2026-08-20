"use client";

import { useState, useTransition, type DragEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Pencil, X } from "lucide-react";

import {
  renameCollectionAction,
  setNoteCollectionAction,
} from "@/app/notes/actions";
import { NoteCard } from "@/components/notes/note-card";
import { ShareCollection } from "@/components/notes/share-collection";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { NoteListItem } from "@/lib/db";
import { NOTE_COLLECTION_MIME, NOTE_ID_MIME } from "@/lib/dnd";

type CollectionGroupProps = {
  name: string;
  notes: NoteListItem[];
  /**
   * How many notes the collection contains, independent of the active filter.
   * The badge reports the collection; the body lists what survived filtering.
   */
  totalCount: number;
  /** Message shown when the group is open but holds nothing. */
  emptyMessage: string;
  /**
   * Present only for real collections. "Uncollected" is the `collection_id is
   * null` bucket rather than a row, so it has no id and cannot be renamed.
   */
  collectionId?: string;
  /**
   * The collection's share token, or null when private. Only meaningful alongside
   * `collectionId` — the Uncollected and Archive sections are views, not rows, and
   * cannot be shared.
   */
  shareToken?: string | null;
  /**
   * Whether a dragged note can be dropped here to join this collection. The
   * "Archive" section reuses this component and must set it false: it has no
   * `collectionId`, which is exactly how "Uncollected" is expressed, so a drop
   * would otherwise resolve to `null` and quietly move the note out of its
   * collection instead of doing nothing.
   */
  droppable?: boolean;
  defaultExpanded?: boolean;
  /**
   * Controls for the group as a whole, rendered above its notes while it is open.
   * Only the Archive uses it, for "Clear archive" — a destructive action that has no
   * business sitting in the header row beside a rename pencil, and that should not be
   * reachable without opening the group and seeing what is in it.
   */
  action?: ReactNode;
  /**
   * Forces the group open regardless of what the user last clicked. Set while a
   * search or tag filter is active, so matches are never hidden inside a
   * collapsed group.
   */
  forceExpanded?: boolean;
};

/**
 * An expandable collection in the sidebar, with inline rename, and the drop
 * target for moving a note into it.
 *
 * The header is a flex row rather than one big button: an edit control nested
 * inside a button would be invalid markup and unreachable by keyboard.
 *
 * Expansion is local `useState` rather than a Collapsible primitive — none is
 * installed, and adding a dependency for a chevron and a boolean is not worth it.
 */
export function CollectionGroup({
  name,
  notes,
  totalCount,
  emptyMessage,
  collectionId,
  shareToken = null,
  droppable = true,
  defaultExpanded = false,
  forceExpanded = false,
  action,
}: CollectionGroupProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const expanded = forceExpanded || open;

  /**
   * The collection a dropped note lands in. `undefined` is the "Uncollected"
   * group, which is the `collection_id is null` bucket rather than a row — so
   * dropping there clears the note's collection.
   */
  const targetCollectionId = collectionId ?? null;

  /**
   * Whether a drag carries a note. Only the *presence* of the MIME type can be
   * tested here: Firefox blocks `getData()` outside the `drop` event, so the
   * note id itself is unreadable while the drag is still in flight.
   */
  function carriesNote(event: DragEvent<HTMLDivElement>) {
    return event.dataTransfer.types.includes(NOTE_ID_MIME);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!carriesNote(event)) return;

    // Without preventDefault the browser refuses the drop outright, and no
    // `drop` event ever fires.
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    // `dragleave` also fires when the pointer crosses into a child element,
    // which would make the highlight flicker across every note card.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!carriesNote(event)) return;

    event.preventDefault();
    setDragOver(false);
    setDropError(null);

    const noteId = event.dataTransfer.getData(NOTE_ID_MIME);
    if (!noteId) return;

    // Empty string means the note was uncollected. Dropping a note back where
    // it already is would write and revalidate for no change.
    const origin = event.dataTransfer.getData(NOTE_COLLECTION_MIME) || null;
    if (origin === targetCollectionId) return;

    startTransition(async () => {
      const result = await setNoteCollectionAction(noteId, targetCollectionId);
      if (result.error) setDropError(result.error);
    });
  }

  function beginEdit() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(name);
    setError(null);
    setEditing(false);
  }

  function save() {
    if (!collectionId) return;

    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      cancelEdit();
      return;
    }

    startTransition(async () => {
      const result = await renameCollectionAction(collectionId, trimmed);

      if (result.error) {
        setError(result.error);
        return;
      }

      setError(null);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="flex items-center gap-1"
        >
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={`Rename collection ${name}`}
            className="h-8"
            onKeyDown={(event) => {
              if (event.key === "Escape") cancelEdit();
            }}
          />
          <button
            type="submit"
            disabled={pending}
            aria-label="Save collection name"
            className="icon-button"
          >
            <Check size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            aria-label="Cancel rename"
            className="icon-button"
          >
            <X size={16} aria-hidden />
          </button>
        </form>

        {error ? (
          <p role="alert" className="px-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    // The whole group is the drop target, not just the header: a collapsed group
    // shows nothing but its header, and an open one is easier to hit as a block.
    <div
      // Not attached at all when the group cannot accept notes, rather than
      // guarded inside each handler: nothing can then fire by accident.
      onDragOver={droppable ? onDragOver : undefined}
      onDragLeave={droppable ? onDragLeave : undefined}
      onDrop={droppable ? onDrop : undefined}
      className={cn(
        "rounded-md ring-2 ring-transparent transition-colors",
        // Without this there is no way to tell which collection a note will land
        // in, which makes the drag guesswork. Full `bg-accent` rather than a
        // fraction of it: a drop target has to be unmistakable, and this is the
        // one hover-weight surface in the app that should shout.
        dragOver && "bg-accent ring-primary",
      )}
    >
      <div className="group flex items-center gap-1 rounded-md px-1.5 transition-colors duration-150 hover:bg-accent">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={expanded}
          className="flex flex-1 items-center gap-1.5 py-2 text-left text-sm font-medium"
        >
          {expanded ? (
            <ChevronDown size={15} aria-hidden className="text-muted-foreground" />
          ) : (
            <ChevronRight size={15} aria-hidden className="text-muted-foreground" />
          )}
          <span className="flex-1 truncate">{name}</span>
        </button>

        {/* Mono and tabular: counts are instrumentation, and they should not shift
            the controls beside them when 9 becomes 10. */}
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {totalCount}
        </span>

        {/* Only a real collection row can be renamed or shared — "Uncollected" and
            "Archive" are views. Compared inline rather than via a hoisted boolean
            so TypeScript narrows `collectionId` to a string in here. */}
        {collectionId !== undefined ? (
          <>
            <button
              type="button"
              onClick={beginEdit}
              aria-label={`Rename collection ${name}`}
              className="row-control"
            >
              <Pencil size={14} aria-hidden />
            </button>

            <ShareCollection
              collectionId={collectionId}
              name={name}
              shareToken={shareToken}
            />
          </>
        ) : null}
      </div>

      {dropError ? (
        <p role="alert" className="px-1 text-xs text-destructive">
          {dropError}
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-1 flex flex-col gap-2 pl-2">
          {action}

          {notes.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          ) : (
            notes.map((note) => <NoteCard key={note.id} note={note} />)
          )}
        </div>
      ) : null}
    </div>
  );
}
