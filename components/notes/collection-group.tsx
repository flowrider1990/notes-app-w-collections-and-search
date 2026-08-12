"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { NoteCard } from "@/components/notes/note-card";
import type { Note } from "@/lib/db";

type CollectionGroupProps = {
  name: string;
  notes: Note[];
  /** Message shown when the group is open but holds nothing. */
  emptyMessage: string;
  defaultExpanded?: boolean;
  /**
   * Forces the group open regardless of what the user last clicked. Set while a
   * search or tag filter is active, so matches are never hidden inside a
   * collapsed group.
   */
  forceExpanded?: boolean;
};

/**
 * An expandable collection in the sidebar.
 *
 * Expansion is local `useState` rather than a Collapsible primitive — none is
 * installed, and adding a dependency for a chevron and a boolean is not worth it.
 */
export function CollectionGroup({
  name,
  notes,
  emptyMessage,
  defaultExpanded = false,
  forceExpanded = false,
}: CollectionGroupProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const expanded = forceExpanded || open;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-left text-sm font-semibold hover:bg-accent"
      >
        {expanded ? (
          <ChevronDown size={16} aria-hidden />
        ) : (
          <ChevronRight size={16} aria-hidden />
        )}
        <span className="flex-1">{name}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {notes.length}
        </span>
      </button>

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
