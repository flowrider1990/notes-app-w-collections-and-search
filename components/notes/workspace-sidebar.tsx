"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { CollectionGroup } from "@/components/notes/collection-group";
import { NewCollection } from "@/components/notes/new-collection";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { Collection, Note, Tag } from "@/lib/db";

type WorkspaceSidebarProps = {
  notes: Note[];
  collections: Collection[];
  tags: Tag[];
};

/**
 * The workspace sidebar: search, tag filter, and collections as expandable
 * groups.
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

  const filtered = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();

    return notes.filter((note) => {
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
    });
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

  const uncollected = filtered.filter((note) => note.collection_id === null);

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
                >
                  <Badge variant={selected ? "default" : "outline"}>
                    {tag.name}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <NewCollection />

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No notes yet. Nothing to show here.
        </p>
      ) : filterActive && filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{noResultsMessage()}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {collections.map((collection) => {
            const inCollection = filtered.filter(
              (note) => note.collection_id === collection.id,
            );

            return (
              <CollectionGroup
                key={collection.id}
                name={collection.name}
                notes={inCollection}
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

          <CollectionGroup
            name="Uncollected"
            notes={uncollected}
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
    </div>
  );
}
