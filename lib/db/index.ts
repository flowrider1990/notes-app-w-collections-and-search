import { createClient } from "@/lib/supabase/server";
import { toTsQuery } from "@/lib/search-query";
import { pickTagColor } from "@/lib/tag-colors";

/**
 * The single centralised data-access module: every Supabase query for notes,
 * collections and tags lives here. Components and Server Actions call these
 * functions and never touch a Supabase client themselves.
 *
 * supabase-js reports failures in `error` instead of throwing, so each function
 * checks it once and throws a readable message. A failed read must never pass
 * itself off as an empty list.
 *
 * RLS scopes every table to `user_id = auth.uid()`, so none of these queries
 * filter by user — the database does it, and no filter here could be safer.
 */

export type Tag = {
  id: string;
  name: string;
  /** One of the palette names in `lib/tag-colors.ts`, enforced by a check constraint. */
  color: string;
};

export type Collection = {
  id: string;
  name: string;
  /** Null when private. Non-null makes the collection readable by link. */
  share_token: string | null;
  created_at: string;
};

/** A shared collection as an anonymous visitor sees it: a name and bare notes. */
export type SharedCollection = {
  name: string;
  notes: { id: string; title: string; body: string }[];
};

/** One recorded search, most recently used first. */
export type SearchHistoryEntry = {
  query: string;
  searched_at: string;
};

export type Note = {
  id: string;
  collection_id: string | null;
  title: string;
  body: string;
  /** Floats the note to the top of its collection, above the time ordering. */
  pinned: boolean;
  /** Hidden from the main sidebar view, but not deleted. */
  archived: boolean;
  created_at: string;
  updated_at: string;
  tags: Tag[];
};

const NOTE_COLUMNS =
  "id, collection_id, title, body, pinned, archived, created_at, updated_at, note_tags(tags(id, name, color))";

const COLLECTION_COLUMNS = "id, name, share_token, created_at";

type NoteRow = Omit<Note, "tags"> & {
  note_tags: { tags: Tag | Tag[] | null }[] | null;
};

/**
 * Flattens the nested `note_tags(tags(...))` shape into a plain tag array.
 * The join row's `tags` arrives as an object or a single-element array
 * depending on how the relationship is inferred, so both are handled.
 */
function toNote({ note_tags, ...note }: NoteRow): Note {
  const tags = (note_tags ?? []).flatMap((join) => {
    if (!join.tags) return [];
    return Array.isArray(join.tags) ? join.tags : [join.tags];
  });

  return { ...note, tags };
}

/**
 * Every note the signed-in user owns — pinned first, then newest first — each
 * with its tags.
 *
 * Tags come from the same round trip rather than a query per note — a nested
 * select here is the difference between one statement and N+1.
 *
 * Ordering is done here rather than in the sidebar so there is one answer to
 * "what order are notes in". Postgres sorts `false` before `true`, so
 * `pinned desc` puts pinned notes on top; callers that filter this list keep the
 * order, because `Array.prototype.filter` preserves it.
 *
 * Archived notes are included. The sidebar already holds every note in memory
 * for search and tag filtering, so it splits them out there — a second query
 * would buy nothing.
 */
export async function getNotes(): Promise<Note[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load notes: ${error.message}`);
  }

  return ((data ?? []) as unknown as NoteRow[]).map(toNote);
}

/**
 * Notes matching a full-text search over title and body, ordered exactly like
 * `getNotes` — pinned first, then newest — so every caller's assumptions hold.
 *
 * Returns `null` when the input has no searchable tokens, which means "no search",
 * not "no matches". The caller shows the unfiltered list instead of an empty one.
 *
 * The query string comes from `toTsQuery`, which strips tsquery operators: raw
 * user text reaching `to_tsquery` raises Postgres 42601 rather than matching
 * nothing. Omitting `type` is what makes supabase-js emit a raw `to_tsquery`,
 * which the trailing `:*` prefix depends on — `websearch` would ignore it. The
 * `config` must stay 'english' to match the generated column, or the stems will
 * not line up and nothing will ever match.
 */
export async function searchNotes(query: string): Promise<Note[] | null> {
  const tsQuery = toTsQuery(query);
  if (!tsQuery) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .textSearch("search_vector", tsQuery, { config: "english" })
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not search notes: ${error.message}`);
  }

  return ((data ?? []) as unknown as NoteRow[]).map(toNote);
}

/** A single note with its tags, or null when no such note is visible. */
export async function getNote(id: string): Promise<Note | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load note: ${error.message}`);
  }

  return data ? toNote(data as unknown as NoteRow) : null;
}

export async function getCollections(): Promise<Collection[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("collections")
    .select(COLLECTION_COLUMNS)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Could not load collections: ${error.message}`);
  }

  return (data ?? []) as Collection[];
}

export async function getTags(): Promise<Tag[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tags")
    .select("id, name, color")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Could not load tags: ${error.message}`);
  }

  return (data ?? []) as Tag[];
}

export async function createCollection(name: string): Promise<Collection> {
  const supabase = await createClient();

  // `user_id` defaults to auth.uid() in the database, so it is not passed here.
  const { data, error } = await supabase
    .from("collections")
    .insert({ name })
    .select(COLLECTION_COLUMNS)
    .single();

  if (error) {
    // Same unique (user_id, name) constraint as renameCollection.
    if (error.code === "23505") {
      throw new Error(`You already have a collection called "${name}".`);
    }
    throw new Error(`Could not create collection "${name}": ${error.message}`);
  }

  return data as Collection;
}

/**
 * Renames a collection.
 *
 * `collections` carries `unique (user_id, name)`, so renaming onto a name the
 * user already has is a constraint violation. Postgres reports that as 23505,
 * which is turned into a message a caller can show verbatim instead of a raw
 * database string.
 */
export async function renameCollection(id: string, name: string): Promise<void> {
  const supabase = await createClient();
  const trimmed = name.trim();

  if (!trimmed) {
    throw new Error("A collection needs a name.");
  }

  const { error } = await supabase
    .from("collections")
    .update({ name: trimmed })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      throw new Error(`You already have a collection called "${trimmed}".`);
    }
    throw new Error(`Could not rename collection: ${error.message}`);
  }
}

/**
 * Creates an empty note and returns it, so the caller can navigate straight to
 * the new id.
 *
 * Nothing but the collection is passed: `title` and `body` are `not null default
 * ''` and `user_id` defaults to `auth.uid()`, so the database supplies the rest.
 * An untitled note is a deliberate starting point — the editor is where a note
 * gets its title, and demanding one up front would put a dialog in front of every
 * new note.
 */
export async function createNote(
  collectionId: string | null = null,
): Promise<Note> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .insert({ collection_id: collectionId })
    .select(NOTE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Could not create note: ${error.message}`);
  }

  return toNote(data as unknown as NoteRow);
}

/**
 * Saves a note's title and body. The only write that touches the text itself —
 * everything else here changes a note's metadata.
 *
 * `.select("id")` is what turns "no such note" into an error. RLS makes an update
 * to a row this user cannot see look exactly like success: zero rows affected,
 * `error: null`. Reading back what was written is the only way to tell the two
 * apart, and silently discarding someone's typing is the worst possible failure
 * mode for an editor.
 */
export async function updateNote(
  id: string,
  fields: { title: string; body: string },
): Promise<void> {
  const supabase = await createClient();

  // `updated_at` is maintained by a database trigger — never set it here.
  const { data, error } = await supabase
    .from("notes")
    .update({ title: fields.title, body: fields.body })
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(`Could not save note: ${error.message}`);
  }

  if ((data ?? []).length === 0) {
    throw new Error("Could not save note: it no longer exists.");
  }
}

/**
 * Deletes a note for good. `archived` is the reversible option; this is not.
 *
 * The note's `note_tags` rows go with it — that foreign key cascades — so a tag
 * is never left pointing at a note that is gone. The tags themselves survive,
 * since they belong to the user rather than to one note.
 *
 * Reads back the id for the same reason as `updateNote`: without it a delete that
 * matched nothing is indistinguishable from one that worked.
 */
export async function deleteNote(id: string): Promise<void> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(`Could not delete note: ${error.message}`);
  }

  if ((data ?? []).length === 0) {
    throw new Error("Could not delete note: it no longer exists.");
  }
}

/** Moves a note into a collection, or out of every collection when null. */
export async function setNoteCollection(
  noteId: string,
  collectionId: string | null,
): Promise<void> {
  const supabase = await createClient();

  // `updated_at` is maintained by a database trigger — never set it here.
  const { error } = await supabase
    .from("notes")
    .update({ collection_id: collectionId })
    .eq("id", noteId);

  if (error) {
    throw new Error(`Could not move note: ${error.message}`);
  }
}

/**
 * Pins or unpins a note. Pinned notes sort above the rest of their collection —
 * see the ordering in `getNotes`.
 */
export async function setNotePinned(
  noteId: string,
  pinned: boolean,
): Promise<void> {
  const supabase = await createClient();

  // `updated_at` is maintained by a database trigger — never set it here. It
  // does get bumped by this update, since the trigger fires on any UPDATE.
  const { error } = await supabase
    .from("notes")
    .update({ pinned })
    .eq("id", noteId);

  if (error) {
    throw new Error(`Could not ${pinned ? "pin" : "unpin"} note: ${error.message}`);
  }
}

/**
 * Archives or restores a note.
 *
 * Archiving is a flag, not a delete: the note keeps its id, its collection and
 * its tags, so restoring it puts it back exactly where it was.
 */
export async function setNoteArchived(
  noteId: string,
  archived: boolean,
): Promise<void> {
  const supabase = await createClient();

  // `updated_at` is maintained by a database trigger — never set it here.
  const { error } = await supabase
    .from("notes")
    .update({ archived })
    .eq("id", noteId);

  if (error) {
    const verb = archived ? "archive" : "restore";
    throw new Error(`Could not ${verb} note: ${error.message}`);
  }
}

/**
 * Attaches a tag to a note, creating the tag on first use.
 *
 * `tags` carries `unique (user_id, name)`, so an existing name is a conflict
 * rather than a new row: the tag is looked up first and only inserted when
 * genuinely new. The `note_tags` insert tolerates duplicates because its
 * composite primary key already makes a second identical link impossible.
 */
export async function addTagToNote(noteId: string, name: string): Promise<void> {
  const supabase = await createClient();
  const trimmed = name.trim();

  if (!trimmed) return;

  const { data: existing, error: lookupError } = await supabase
    .from("tags")
    .select("id, name")
    .eq("name", trimmed)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Could not look up tag "${trimmed}": ${lookupError.message}`);
  }

  let tagId = existing?.id;

  if (!tagId) {
    // The colour is chosen once, here, and then persisted — so the tag keeps the
    // same colour everywhere it appears rather than being re-derived per render.
    const { data: created, error: insertError } = await supabase
      .from("tags")
      .insert({ name: trimmed, color: pickTagColor(trimmed) })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(`Could not create tag "${trimmed}": ${insertError.message}`);
    }

    tagId = created.id;
  }

  const { error: linkError } = await supabase
    .from("note_tags")
    .upsert(
      { note_id: noteId, tag_id: tagId },
      { onConflict: "note_id,tag_id", ignoreDuplicates: true },
    );

  if (linkError) {
    throw new Error(`Could not tag note: ${linkError.message}`);
  }
}

/** Detaches a tag from a note. The tag itself is left in place. */
export async function removeTagFromNote(
  noteId: string,
  tagId: string,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("note_tags")
    .delete()
    .eq("note_id", noteId)
    .eq("tag_id", tagId);

  if (error) {
    throw new Error(`Could not remove tag: ${error.message}`);
  }
}

/**
 * Makes a collection readable by anyone holding the returned token.
 *
 * The token is generated here with `crypto.randomUUID()` rather than by the
 * database, because supabase-js has no way to put a `gen_random_uuid()` call into
 * an update. It is a v4 uuid from the platform CSPRNG, so it is not guessable.
 *
 * Re-sharing an already shared collection issues a fresh token, which invalidates
 * the previous link.
 */
export async function shareCollection(id: string): Promise<string> {
  const supabase = await createClient();
  const token = crypto.randomUUID();

  const { error } = await supabase
    .from("collections")
    .update({ share_token: token })
    .eq("id", id);

  if (error) {
    throw new Error(`Could not share collection: ${error.message}`);
  }

  return token;
}

/** Revokes sharing. Every link handed out for this collection stops working. */
export async function unshareCollection(id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("collections")
    .update({ share_token: null })
    .eq("id", id);

  if (error) {
    throw new Error(`Could not stop sharing collection: ${error.message}`);
  }
}

/**
 * A shared collection, readable without a session. Returns null for an unknown or
 * revoked token.
 *
 * Goes through the `shared_collection` Postgres function rather than a table
 * select, because RLS scopes `collections` and `notes` to `auth.uid()` and an
 * anonymous visitor has none. The function is `security definer` and takes the
 * token as an argument, so it exposes exactly one collection to whoever holds the
 * link and nothing to anyone who does not. See section 6 of docs/schema.sql.
 *
 * Zero rows means the token does not match. A single row with a null `note_id`
 * means the collection is shared but empty — that is what the function's left join
 * is for, and why the note rows are filtered rather than trusted.
 */
export async function getSharedCollection(
  token: string,
): Promise<SharedCollection | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("shared_collection", { token });

  if (error) {
    throw new Error(`Could not load shared collection: ${error.message}`);
  }

  const rows = (data ?? []) as {
    collection_name: string;
    note_id: string | null;
    note_title: string | null;
    note_body: string | null;
  }[];

  if (rows.length === 0) return null;

  return {
    name: rows[0].collection_name,
    notes: rows
      .filter((row) => row.note_id !== null)
      .map((row) => ({
        id: row.note_id as string,
        title: row.note_title ?? "",
        body: row.note_body ?? "",
      })),
  };
}

/** The most recently used searches, newest first. */
export async function getSearchHistory(
  limit = 8,
): Promise<SearchHistoryEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("search_history")
    .select("query, searched_at")
    .order("searched_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Could not load search history: ${error.message}`);
  }

  return (data ?? []) as SearchHistoryEntry[];
}

/**
 * Records a search, or bumps it to the top if it has been run before.
 *
 * `user_id` is not passed — it defaults to `auth.uid()` in the database — while the
 * conflict target is `(user_id, query)`. The default is applied before conflict
 * resolution, so this works, but it is the one mechanism here worth confirming
 * against the real database rather than assuming.
 *
 * `searched_at` is set explicitly because `default now()` only applies to the
 * insert; on the update path the row would otherwise keep its original timestamp
 * and never move up the list.
 */
export async function recordSearch(query: string): Promise<void> {
  const supabase = await createClient();
  const trimmed = query.trim();

  if (!trimmed) return;

  const { error } = await supabase.from("search_history").upsert(
    { query: trimmed, searched_at: new Date().toISOString() },
    { onConflict: "user_id,query" },
  );

  if (error) {
    throw new Error(`Could not record search: ${error.message}`);
  }
}

/** Forgets one recorded search. */
export async function removeSearchHistoryEntry(query: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("search_history")
    .delete()
    .eq("query", query);

  if (error) {
    throw new Error(`Could not remove search: ${error.message}`);
  }
}

/**
 * Clears the whole history.
 *
 * PostgREST refuses an unfiltered delete, so this filters on `query is not null` —
 * true for every row, since the column is `not null`. RLS still scopes the delete
 * to this user, so "every row" means every row of theirs.
 */
export async function clearSearchHistory(): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("search_history")
    .delete()
    .not("query", "is", null);

  if (error) {
    throw new Error(`Could not clear search history: ${error.message}`);
  }
}
