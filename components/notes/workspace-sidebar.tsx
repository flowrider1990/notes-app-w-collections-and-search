"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { CollectionGroup } from "@/components/notes/collection-group";
import { NewCollection } from "@/components/notes/new-collection";
import { TagPill } from "@/components/notes/tag-pill";
import { Input } from "@/components/ui/input";
import type { Collection, Note, Tag } from "@/lib/db";

type WorkspaceSidebarProps = {
  notes: Note[];
  collections: Collection[];
  tags: Tag[];
};

/**
 * The workspace sidebar: search, tag filter, collections as expandable groups,
 * and an Archive section holding notes taken out of the main view.
 *
 * Notes arrive once as props from the layout, and both search and tag filtering
 * run here over that in-memory set. That is what makes results update as the
 * user types without a query per keystroke.
 */
export function WorkspaceSidebar({
  notes,
  collections,
  tags,
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const trimmedQuery = query.trim();
  const filterActive = trimmedQuery.length > 0 || selectedTagIds.length > 0;

  /**
   * `getNotes` returns archived notes too, so they are split out here rather than
   * in a second query. The same filter runs over both halves: searching should
   * find an archived note, since that is how you locate one to restore.
   */
  const { activeNotes, archivedNotes, filteredActive, filteredArchived } =
    useMemo(() => {
      const needle = trimmedQuery.toLowerCase();

      const matches = (note: Note) => {
        // AND semantics: the note must carry *every* selected tag.
        const carriesAllTags = selectedTagIds.every((tagId) =>
          note.tags.some((tag) => tag.id === tagId),
        );
        if (!carriesAllTags) return false;

        // Search composes with the tag filter rather than replacing it.
        if (!needle) return true;
        return (
          note.title.toLowerCase().includes(needle) ||
          note.body.toLowerCase().includes(needle)
        );
      };

      const active = notes.filter((note) => !note.archived);
      const archived = notes.filter((note) => note.archived);

      // `filter` preserves order, so the pinned-first ordering from `getNotes`
      // survives every one of these passes.
      return {
        activeNotes: active,
        archivedNotes: archived,
        filteredActive: active.filter(matches),
        filteredArchived: archived.filter(matches),
      };
    }, [notes, trimmedQuery, selectedTagIds]);

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId],
    );
  }

  function noResultsMessage() {
    if (trimmedQuery && selectedTagIds.length > 0) {
      return `No notes match "${trimmedQuery}" and the selected tags.`;
    }
    if (trimmedQuery) {
      return `No notes match "${trimmedQuery}".`;
    }
    return "No notes carry all of the selected tags.";
  }

  const uncollected = filteredActive.filter((note) => note.collection_id === null);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes"
          aria-label="Search notes"
          className="pl-9"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Tags
        </p>
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tags yet. Open a note to add one.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => {
              const selected = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  aria-pressed={selected}
                  className="rounded-md"
                >
                  <TagPill tag={tag} selected={selected} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <NewCollection />

      {activeNotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {archivedNotes.length > 0
            ? "Every note is archived. Restore one from the Archive below."
            : "No notes yet. Nothing to show here."}
        </p>
      ) : filterActive && filteredActive.length === 0 ? (
        <p className="text-sm text-muted-foreground">{noResultsMessage()}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {collections.map((collection) => {
            const inCollection = filteredActive.filter(
              (note) => note.collection_id === collection.id,
            );
            // Counted from the unfiltered set, minus archived notes: the badge
            // reports what the collection holds in the main view, not what
            // survived the current filter.
            const totalInCollection = activeNotes.filter(
              (note) => note.collection_id === collection.id,
            ).length;

            return (
              <CollectionGroup
                key={collection.id}
                collectionId={collection.id}
                name={collection.name}
                notes={inCollection}
                totalCount={totalInCollection}
                emptyMessage={
                  filterActive
                    ? "No notes here match the current filter."
                    : "This collection is empty."
                }
                // While filtering, open only the groups that actually have
                // matches — otherwise hits stay hidden behind a chevron.
                forceExpanded={filterActive && inCollection.length > 0}
              />
            );
          })}

          {/* No collectionId: "Uncollected" is the collection_id-is-null bucket
              rather than a row, so it offers no rename control. */}
          <CollectionGroup
            name="Uncollected"
            notes={uncollected}
            totalCount={
              activeNotes.filter((note) => note.collection_id === null).length
            }
            defaultExpanded
            emptyMessage={
              filterActive
                ? "No uncollected notes match the current filter."
                : "Every note belongs to a collection."
            }
            forceExpanded={filterActive && uncollected.length > 0}
          />
        </div>
      )}

      {/* Outside the branches above on purpose. Both of them test the *active*
          set, so archiving every note would otherwise leave the sidebar saying
          there is nothing to show and render no Archive — stranding the notes
          with no way to restore them.

          `droppable={false}` because Archive has no collectionId, which is how
          "Uncollected" is expressed: a drop here would resolve to null and move
          the note out of its collection rather than archiving it. */}
      <CollectionGroup
        name="Archive"
        notes={filteredArchived}
        totalCount={archivedNotes.length}
        droppable={false}
        emptyMessage={
          filterActive
            ? "No archived notes match the current filter."
            : "Nothing archived."
        }
        forceExpanded={filterActive && filteredArchived.length > 0}
      />
    </div>
  );
}
