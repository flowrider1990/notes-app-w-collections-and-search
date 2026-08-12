"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, ChevronRight, Pencil, X } from "lucide-react";

import { renameCollectionAction } from "@/app/notes/actions";
import { NoteCard } from "@/components/notes/note-card";
import { Input } from "@/components/ui/input";
import type { Note } from "@/lib/db";

type CollectionGroupProps = {
  name: string;
  notes: Note[];
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
  defaultExpanded?: boolean;
  /**
   * Forces the group open regardless of what the user last clicked. Set while a
   * search or tag filter is active, so matches are never hidden inside a
   * collapsed group.
   */
  forceExpanded?: boolean;
};

/**
 * An expandable collection in the sidebar, with inline rename.
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
  defaultExpanded = false,
  forceExpanded = false,
}: CollectionGroupProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const expanded = forceExpanded || open;
  const renameable = collectionId !== undefined;

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
            className="rounded p-1 hover:bg-accent disabled:opacity-50"
          >
            <Check size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            aria-label="Cancel rename"
            className="rounded p-1 hover:bg-accent"
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
    <div>
      <div className="group flex items-center gap-1 rounded-md px-1 hover:bg-accent">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={expanded}
          className="flex flex-1 items-center gap-1 py-1.5 text-left text-sm font-semibold"
        >
          {expanded ? (
            <ChevronDown size={16} aria-hidden />
          ) : (
            <ChevronRight size={16} aria-hidden />
          )}
          <span className="flex-1">{name}</span>
        </button>

        <span className="text-xs font-normal text-muted-foreground">
          {totalCount}
        </span>

        {renameable ? (
          <button
            type="button"
            onClick={beginEdit}
            aria-label={`Rename collection ${name}`}
            className="rounded p-1 opacity-0 transition-opacity hover:bg-background focus:opacity-100 group-hover:opacity-100"
          >
            <Pencil size={14} aria-hidden />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-1 flex flex-col gap-2 pl-2">
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
