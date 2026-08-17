"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";

import { recordSearchAction, searchNotesAction } from "@/app/notes/actions";
import { CollectionGroup } from "@/components/notes/collection-group";
import { NewCollection } from "@/components/notes/new-collection";
import { NewNote } from "@/components/notes/new-note";
import { SearchHistory } from "@/components/notes/search-history";
import { TagPill } from "@/components/notes/tag-pill";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Collection, Note, SearchHistoryEntry, Tag } from "@/lib/db";

type WorkspaceSidebarProps = {
  notes: Note[];
  collections: Collection[];
  tags: Tag[];
  searchHistory: SearchHistoryEntry[];
};

/** Long enough to stop a query per keystroke, short enough to feel immediate. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The workspace sidebar: search, tag filter, collections as expandable groups,
 * and an Archive section holding notes taken out of the main view.
 *
 * Search is server-side full-text search, so it goes to the database on a debounce
 * rather than filtering the prop set. The tag filter stays in the client, because
 * the notes are already here and tags are cheap to compare.
 *
 * The full `notes` prop is still what the count badges report — a badge describes
 * what a collection holds, not what the current search turned up.
 */
export function WorkspaceSidebar({
  notes,
  collections,
  tags,
  searchHistory,
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  /** Server search results. `null` means no active search — render everything. */
  const [results, setResults] = useState<Note[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, startSearchTransition] = useTransition();
  const [, startRecordTransition] = useTransition();

  /**
   * Server Actions cannot be aborted, so a slow response for "sh" can land after
   * a fast one for "shopping" and overwrite it. Every request takes a number and
   * only the newest is allowed to write state.
   */
  const requestId = useRef(0);

  const trimmedQuery = query.trim();
  const filterActive = trimmedQuery.length > 0 || selectedTagIds.length > 0;

  useEffect(() => {
    // Clearing the box restores the full list with no round trip at all.
    if (!trimmedQuery) {
      requestId.current += 1;
      setResults(null);
      setSearchError(null);
      return;
    }

    // Referenced deliberately so this effect re-runs when a mutation revalidates
    // the workspace. Without it, pinning or archiving mid-search would leave the
    // visible result list in its pre-mutation order until the next keystroke.
    void notes;

    const id = ++requestId.current;

    const timer = setTimeout(() => {
      startSearchTransition(async () => {
        const result = await searchNotesAction(trimmedQuery);
        if (id !== requestId.current) return;

        if (result.error) {
          setSearchError(result.error);
          return;
        }

        setSearchError(null);
        // `null` here means the query held nothing searchable — punctuation only,
        // say — which is "no search", not "no matches".
        setResults(result.notes);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmedQuery, notes]);

  /** Recorded only on commit — never on the debounce tick. */
  function commitSearch(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;

    startRecordTransition(async () => {
      const result = await recordSearchAction(trimmed);
      if (result.error) setSearchError(result.error);
    });
  }

  function pickFromHistory(value: string) {
    setQuery(value);
    // Re-running a past search bumps it back to the top of the history.
    commitSearch(value);
  }

  /** Badge counts and the empty states describe the whole workspace. */
  const { activeNotes, archivedNotes } = useMemo(
    () => ({
      activeNotes: notes.filter((note) => !note.archived),
      archivedNotes: notes.filter((note) => note.archived),
    }),
    [notes],
  );

  /**
   * What actually gets listed: the search results when a search is active,
   * otherwise everything, narrowed by the tag filter and split by archived state.
   */
  const { filteredActive, filteredArchived } = useMemo(() => {
    const source = results ?? notes;

    // AND semantics: the note must carry *every* selected tag.
    const visible = source.filter((note) =>
      selectedTagIds.every((tagId) =>
        note.tags.some((tag) => tag.id === tagId),
      ),
    );

    // `filter` preserves order, so the pinned-first ordering from the query
    // survives every one of these passes.
    return {
      filteredActive: visible.filter((note) => !note.archived),
      filteredArchived: visible.filter((note) => note.archived),
    };
  }, [results, notes, selectedTagIds]);

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
      <div className="flex flex-col gap-1">
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
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitSearch(query);
              }
            }}
            placeholder="Search notes"
            aria-label="Search notes"
            className="pl-9"
          />
        </div>

        {searching ? (
          <p className="px-1 text-xs text-muted-foreground">Searching…</p>
        ) : null}

        {searchError ? (
          <p role="alert" className="px-1 text-xs text-destructive">
            {searchError}
          </p>
        ) : null}

        <SearchHistory entries={searchHistory} onPick={pickFromHistory} />
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

      <div className="flex flex-col gap-2">
        <NewNote />
        <NewCollection />
      </div>

      {activeNotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {archivedNotes.length > 0
            ? "Every note is archived. Restore one from the Archive below."
            : "No notes yet. Nothing to show here."}
        </p>
      ) : filterActive && filteredActive.length === 0 ? (
        <p className="text-sm text-muted-foreground">{noResultsMessage()}</p>
      ) : (
        /* Faded while a search is in flight. The previous results stay mounted on
           purpose — swapping them for a skeleton on every keystroke would be far
           worse than showing them slightly stale — but at full opacity they look
           like an answer to the query being typed, which they are not. */
        <div
          aria-busy={searching}
          className={cn(
            "flex flex-col gap-2 transition-opacity",
            searching && "opacity-50",
          )}
        >
          {collections.map((collection) => {
            const inCollection = filteredActive.filter(
              (note) => note.collection_id === collection.id,
            );
            // Counted from the whole workspace, minus archived notes: the badge
            // reports what the collection holds in the main view, not what
            // survived the current search or filter.
            const totalInCollection = activeNotes.filter(
              (note) => note.collection_id === collection.id,
            ).length;

            return (
              <CollectionGroup
                key={collection.id}
                collectionId={collection.id}
                shareToken={collection.share_token}
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
              rather than a row, so it offers no rename or share control. */}
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
