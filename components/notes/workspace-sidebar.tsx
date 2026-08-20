"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";

import { recordSearchAction, searchNotesAction } from "@/app/notes/actions";
import { ClearArchive } from "@/components/notes/clear-archive";
import { CollectionGroup } from "@/components/notes/collection-group";
import { NewCollection } from "@/components/notes/new-collection";
import { SearchHistory } from "@/components/notes/search-history";
import { TagManager } from "@/components/notes/tag-manager";
import { TagPill } from "@/components/notes/tag-pill";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";
import type {
  Collection,
  Note,
  NoteListItem,
  SearchHistoryEntry,
  Tag,
} from "@/lib/db";

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
  /** Whether the Tags section is showing filter pills or the rename/delete rows. */
  const [managingTags, setManagingTags] = useState(false);
  /**
   * Server search results. `null` means no active search — render everything.
   *
   * `NoteListItem`, the narrowed shape the action returns, rather than `Note`. A
   * full `Note` still satisfies it, so the server-rendered `notes` prop feeds the
   * same list path below without a conversion.
   */
  const [results, setResults] = useState<NoteListItem[] | null>(null);
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

  /**
   * A fingerprint of everything the result list actually renders from.
   *
   * The search effect has to re-run when a mutation changes the notes, or pinning
   * something mid-search would leave the visible results in their pre-mutation state.
   * Depending on the `notes` array itself did that — but `revalidatePath` hands down a
   * new array on *every* mutation, including ones that touch nothing on screen here.
   * Recording a search is the worst case: pressing Enter writes to `search_history`,
   * revalidates, and paid for a second identical full-text query.
   *
   * A string of the fields the cards read means an unrelated revalidation produces an
   * identical value and no query at all, while a real change to any note still
   * re-runs the search.
   */
  const notesFingerprint = useMemo(
    () =>
      notes
        .map((note) =>
          [
            note.id,
            note.updated_at,
            note.pinned,
            note.archived,
            note.collection_id,
            note.tags.map((tag) => tag.id).join("."),
          ].join(":"),
        )
        .join("|"),
    [notes],
  );

  useEffect(() => {
    // Clearing the box restores the full list with no round trip at all.
    if (!trimmedQuery) {
      requestId.current += 1;
      setResults(null);
      setSearchError(null);
      return;
    }

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
    // The fingerprint, not the array: see `notesFingerprint` above.
  }, [trimmedQuery, notesFingerprint]);

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

  /**
   * How many notes carry each tag. Counted across the whole workspace, archived
   * notes included: the delete confirmation is about what the tag is attached to,
   * not about what the current view happens to show.
   */
  const tagUsage = useMemo(() => {
    const counts = new Map<string, number>();

    for (const note of notes) {
      for (const tag of note.tags) {
        counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
      }
    }

    return counts;
  }, [notes]);

  /**
   * A deleted tag has to leave the filter too. Left in place it would keep
   * narrowing the list — AND semantics, so to nothing at all — with no pill on
   * screen to explain it or to switch off.
   */
  function forgetTag(tagId: string) {
    setSelectedTagIds((current) => current.filter((id) => id !== tagId));
  }

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
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
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
            className="pl-9 pr-9"
          />

          {/* Inside the field rather than on a line of its own. As a block below
              the input it entered and left the flow on every debounce tick, so
              the entire list below it jumped by the height of one line each time
              the user paused typing. */}
          {searching ? (
            <Loader2
              size={15}
              aria-hidden
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          ) : null}
        </div>

        {/* The spinner is decoration; this is what a screen reader hears. */}
        <span role="status" className="sr-only">
          {searching ? "Searching…" : ""}
        </span>

        {searchError ? (
          <p role="alert" className="px-1 text-xs text-destructive">
            {searchError}
          </p>
        ) : null}

        <SearchHistory entries={searchHistory} onPick={pickFromHistory} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Tags</SectionLabel>

          {/* Offered even with no tags, because creating the first one happens in
              there. Set in the same mono as the label beside it: this is the app
              talking about the section, not content. */}
          <button
            type="button"
            onClick={() => setManagingTags((current) => !current)}
            aria-expanded={managingTags}
            className="-mr-1 inline-flex h-8 items-center rounded-md px-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {managingTags ? "Done" : "Manage"}
          </button>
        </div>

        {managingTags ? (
          <TagManager
            tags={tags}
            usage={tagUsage}
            selectedTagIds={selectedTagIds}
            onDeleted={forgetTag}
          />
        ) : tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tags yet. Add one to a note, or create one under Manage.
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

      {/* Label, create control and the list itself are one section: the gap-7
          rhythm between sections would otherwise strand the label from the groups
          it names. */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Collections</SectionLabel>
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
      </div>

      {/* Only once something is actually archived. A permanent section reading
          "Nothing archived." is a row of furniture describing an absence, and it
          is the last thing in a column the user scrolls to reach.

          Keyed off the unfiltered `archivedNotes`, and outside the branches above
          on purpose: those test the *active* set, so archiving every note would
          otherwise leave the sidebar saying there is nothing to show and render no
          Archive — stranding the notes with no way to restore them.

          `droppable={false}` because Archive has no collectionId, which is how
          "Uncollected" is expressed: a drop here would resolve to null and move
          the note out of its collection rather than archiving it. */}
      {archivedNotes.length > 0 ? (
        <CollectionGroup
          name="Archive"
          notes={filteredArchived}
          totalCount={archivedNotes.length}
          droppable={false}
          emptyMessage="No archived notes match the current filter."
          forceExpanded={filterActive && filteredArchived.length > 0}
          // The unfiltered count: clearing the archive deletes everything in it, not
          // just the cards a search left visible.
          action={<ClearArchive count={archivedNotes.length} />}
        />
      ) : null}
    </div>
  );
}
