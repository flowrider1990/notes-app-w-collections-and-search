import "server-only";

import { UserFacingError } from "@/lib/db/errors";
import { createClient } from "@/lib/supabase/server";
import { toTsQuery } from "@/lib/search-query";
import { pickTagColor, TAG_COLORS, type TagColor } from "@/lib/tag-colors";

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
 *
 * `import "server-only"` is the boundary that keeps it that way. Every client
 * component that imports the types below does so with `import type`, which erases
 * at compile time, so the marker costs them nothing. What it buys is the
 * error message: a mistaken *value* import was already refused, because this
 * module transitively reaches `next/headers`, but that failure is reported as
 * "you are using it in the Pages Router" — true of nothing here. The marker
 * makes the build say `'server-only' cannot be imported from a Client
 * Component module` instead.
 */

export type Tag = {
  id: string;
  name: string;
  /** One of the palette names in `lib/tag-colors.ts`, enforced by a check constraint. */
  color: string;
};

/**
 * A collection as the workspace lists it.
 *
 * `is_shared` rather than the token itself. The sidebar renders one of these per
 * collection, and every prop a client component holds is serialised into the
 * payload the browser receives — so carrying `share_token` here put a bearer
 * capability, the one thing that grants anonymous read of the collection, into
 * every `/notes` response, for every collection, whether or not its share menu was
 * ever opened. RLS never let a stranger read it, but the owner's own tokens had no
 * reason to be there. The list only needs to know *whether* a link exists;
 * `getCollectionShareToken` fetches the token when the menu is actually open.
 */
export type Collection = {
  id: string;
  name: string;
  /** Whether a share link exists. The token itself is fetched on demand. */
  is_shared: boolean;
  created_at: string;
};

/** The `collections` columns as Postgres returns them, before the projection below. */
type CollectionRow = {
  id: string;
  name: string;
  share_token: string | null;
  created_at: string;
};

/**
 * Projects a collection row to what a client component may hold.
 *
 * Mirrors `toNoteListItem`: the point of this function is the boundary, not the
 * bytes off the wire. `share_token` is still selected, because `is_shared` is
 * derived from it and PostgREST cannot compute the boolean — it just stops here.
 */
function toCollection({
  id,
  name,
  share_token,
  created_at,
}: CollectionRow): Collection {
  return { id, name, is_shared: share_token !== null, created_at };
}

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

/** One image attached to a note. The bytes live in Storage, never in Postgres. */
export type NoteImage = {
  id: string;
  /** Location inside the `note-images` bucket: `{user_id}/{note_id}/{uuid}.{ext}`. */
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

/**
 * A note image with a URL that can actually render it. The bucket is private, so
 * the URL is signed and short-lived — see `SIGNED_URL_TTL_SECONDS`.
 */
export type SignedNoteImage = NoteImage & { url: string };

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

/**
 * A note as the sidebar's list renders it, and the shape `searchNotes` returns.
 *
 * A Server Action's return value is serialized and sent to the browser, so the
 * result of a search is a server-to-client boundary as much as any prop. Returning
 * `Note` made the database row's column list define that boundary: the next column
 * added to `notes` — a moderation flag, a per-note sharing state, anything internal
 * — would reach the browser through the search box with no code change and nothing
 * to review.
 *
 * These seven fields are what the chain from the results downwards actually reads
 * (`workspace-sidebar` filters on `tags`, `archived` and `collection_id`; `NoteCard`
 * renders `title`, `body`, `pinned` and links by `id`). Of the two left out,
 * `updated_at` is read once — by the sidebar's search fingerprint, over the
 * server-rendered `notes` prop rather than over any search result — and
 * `created_at` by nothing outside this query's ordering.
 *
 * `Pick` rather than a fresh literal: the field types stay tied to the row, so a
 * column that changes type cannot quietly disagree with the DTO.
 *
 * Note what this deliberately does *not* do. `CollectionOption` and
 * `NoteImageThumbnail` each declare the field they exclude as `?: never`, so
 * handing over a whole row is a compile error. That guard cannot go here, because
 * a full `Note` has to stay assignable: `app/notes/layout.tsx` feeds
 * server-rendered `Note[]` down the same `CollectionGroup` and `NoteCard` path the
 * search results take, and `?: never` would reject it. So the boundary here rests
 * on `toNoteListItem` returning a literal and nothing else — a weaker guarantee,
 * and the reason that function names its fields one by one instead of spreading.
 */
export type NoteListItem = Pick<
  Note,
  "id" | "collection_id" | "title" | "body" | "pinned" | "archived" | "tags"
>;

const NOTE_COLUMNS =
  "id, collection_id, title, body, pinned, archived, created_at, updated_at, note_tags(tags(id, name, color))";

// The row shape, not the DTO: `share_token` is read so `toCollection` can derive
// `is_shared` from it, and is dropped there rather than sent to the client.
const COLLECTION_COLUMNS = "id, name, share_token, created_at";

/**
 * Guards the uuid arguments that do not come from a row we just read: the share
 * token out of a URL, the collection id a client component asks about, and the
 * note id `addNoteImage` interpolates into a Storage object key.
 *
 * Two different reasons, so both are worth stating. For the queries, `.eq` on a
 * uuid column raises 42P02 on anything malformed. For the object key there is no
 * column to complain — the value becomes part of a path, and the check is what
 * keeps an unvalidated one from being written and then swept up again.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The private bucket holding note attachments. */
const IMAGE_BUCKET = "note-images";

/**
 * How long a signed image URL stays valid. Long enough to read a note and come
 * back to it, short enough that a URL copied out of the page stops working — which
 * is the point of a private bucket.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const NOTE_IMAGE_COLUMNS = "id, storage_path, mime_type, size_bytes, created_at";

/**
 * What may be attached, and how large. The bucket enforces both server-side; these
 * are here so the app can refuse a file without a round trip, and so the error the
 * user sees names the actual limit.
 */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Looks up the extension for a MIME type, or null if it is not allowed.
 *
 * `Object.hasOwn` rather than a bare index: the type comes off an uploaded file, and
 * a plain lookup answers for inherited members too, so `Content-Type: toString` would
 * resolve to a function and read as permitted.
 */
function imageExtension(mimeType: string): string | null {
  return Object.hasOwn(ALLOWED_IMAGE_TYPES, mimeType)
    ? ALLOWED_IMAGE_TYPES[mimeType]
    : null;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type NoteRow = Omit<Note, "tags"> & {
  note_tags: { tags: Tag | Tag[] | null }[] | null;
};

/**
 * Turns "the write matched no rows" into an error.
 *
 * Every update and delete here ends with `.select("id")` and passes the result
 * through this. RLS makes a write to a row the caller cannot see look exactly like
 * success — zero rows affected, `error: null` — so without reading back what was
 * touched, a stale id from a sidebar rendered seconds ago reports "saved" and
 * changes nothing. That is the single most misleading failure this data layer can
 * produce, so nothing is allowed to skip it.
 */
function assertWriteHit(rows: unknown[] | null, subject: string): void {
  if ((rows ?? []).length === 0) {
    throw new UserFacingError(`Could not ${subject}: it no longer exists.`);
  }
}

/**
 * Names the one refusal the two collection writes can now produce.
 *
 * A note may only reference a collection its own owner holds. The database is the
 * authority on that — `notes_insert` / `notes_update` reject it as `42501`, and the
 * composite key `notes_collection_owner_fkey` as `23503`, whichever is reached first
 * (see `supabase/migrations/20260819133628_scope_note_collection_to_owner.sql`).
 * Neither code carries a message a user could act on, so the two callers translate
 * it. This adds no check of its own and no round trip: passing a foreign collection
 * id still fails in Postgres, not here.
 */
function isForeignCollection(error: { code?: string }): boolean {
  return error.code === "42501" || error.code === "23503";
}

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
 * Drops a full note to the fields a list needs.
 *
 * Applied after `toNote` rather than by selecting fewer columns: `NOTE_COLUMNS`
 * carries the tag join that `toNote` flattens, and duplicating it to save two
 * timestamps would put two column lists out of step for no measurable gain. The
 * point of this function is the boundary, not the bytes off the wire.
 */
function toNoteListItem({
  id,
  collection_id,
  title,
  body,
  pinned,
  archived,
  tags,
}: Note): NoteListItem {
  return { id, collection_id, title, body, pinned, archived, tags };
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
 * `NoteListItem`, not `Note`: this result is the one that travels back through a
 * Server Action to the browser. See the type for what is left out and why.
 *
 * The query string comes from `toTsQuery`, which strips tsquery operators: raw
 * user text reaching `to_tsquery` raises Postgres 42601 rather than matching
 * nothing. Omitting `type` is what makes supabase-js emit a raw `to_tsquery`,
 * which the trailing `:*` prefix depends on — `websearch` would ignore it. The
 * `config` must stay 'english' to match the generated column, or the stems will
 * not line up and nothing will ever match.
 */
export async function searchNotes(
  query: string,
): Promise<NoteListItem[] | null> {
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

  return ((data ?? []) as unknown as NoteRow[])
    .map(toNote)
    .map(toNoteListItem);
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

  return ((data ?? []) as CollectionRow[]).map(toCollection);
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
      throw new UserFacingError(`You already have a collection called "${name}".`);
    }
    throw new Error(`Could not create collection "${name}": ${error.message}`);
  }

  return toCollection(data as CollectionRow);
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
    throw new UserFacingError("A collection needs a name.");
  }

  const { data, error } = await supabase
    .from("collections")
    .update({ name: trimmed })
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      throw new UserFacingError(`You already have a collection called "${trimmed}".`);
    }
    throw new Error(`Could not rename collection: ${error.message}`);
  }

  assertWriteHit(data, "rename that collection");
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
    if (isForeignCollection(error)) {
      throw new UserFacingError(
        "Could not create note: that collection does not exist, or belongs to another account.",
      );
    }

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

  assertWriteHit(data, "save that note");
}

/**
 * Deletes a note for good. `archived` is the reversible option; this is not.
 *
 * The note's `note_tags` and `note_images` rows go with it — both foreign keys
 * cascade — so nothing is left pointing at a note that is gone. The tags themselves
 * survive, since they belong to the user rather than to one note.
 *
 * The image *files* have to be removed by hand, because Postgres cannot cascade into
 * Storage. Order matters and there is no transaction spanning both: the paths are
 * read first, the row is deleted, and only then are the files removed. Deleting the
 * files first would risk destroying them and then failing to delete the note —
 * irreversible loss with the note still sitting there. This way the worst case is
 * orphaned objects: waste, not loss.
 *
 * Reads back the id for the same reason as `updateNote`: without it a delete that
 * matched nothing is indistinguishable from one that worked.
 */
export async function deleteNote(id: string): Promise<void> {
  const supabase = await createClient();

  // Read before the delete: the cascade takes these rows with it, and after that
  // nothing knows which files belonged to this note.
  const paths = await imagePathsForNote(id);

  const { data, error } = await supabase
    .from("notes")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(`Could not delete note: ${error.message}`);
  }

  assertWriteHit(data, "delete that note");

  if (paths.length > 0) {
    // Deliberately not fatal. The note is gone, which is what was asked; a failure
    // here leaves unreachable files behind, and reporting that as "could not delete
    // the note" would describe the wrong outcome to someone whose note has in fact
    // been deleted. There is nothing they could do about it either way.
    await supabase.storage.from(IMAGE_BUCKET).remove(paths);
  }
}

/**
 * Deletes every archived note, and returns how many went.
 *
 * Same ordering as `deleteNote`, for the same reason: read the image paths, delete
 * the rows, then remove the files. Postgres cascades `note_images`, Storage knows
 * nothing about it, and there is no transaction spanning both — so the order is
 * chosen to make the worst case orphaned objects rather than files destroyed for a
 * note that then failed to delete.
 *
 * One statement for the rows rather than a loop over `deleteNote`. A loop would be N
 * round trips and, worse, could fail half way and leave the user staring at a
 * partly-cleared archive with an error that does not say how far it got. The count
 * comes back from the delete itself, so the number reported is the number deleted.
 *
 * No `assertWriteHit`: this targets a set, not one row by id, and an empty archive is
 * not a failure. Zero is a truthful answer that the caller reports as "nothing to
 * clear".
 *
 * RLS scopes both statements to the signed-in user, so `archived = true` can never
 * reach someone else's notes.
 */
export async function deleteArchivedNotes(): Promise<number> {
  const supabase = await createClient();

  const { data: archived, error: listError } = await supabase
    .from("notes")
    .select("id")
    .eq("archived", true);

  if (listError) {
    throw new Error(`Could not list archived notes: ${listError.message}`);
  }

  const ids = (archived ?? []).map((row) => (row as { id: string }).id);
  if (ids.length === 0) return 0;

  // Read before the delete: the cascade takes these rows with it, and after that
  // nothing knows which files belonged to which note.
  const { data: images, error: imageError } = await supabase
    .from("note_images")
    .select("storage_path")
    .in("note_id", ids);

  if (imageError) {
    throw new Error(`Could not list the notes' images: ${imageError.message}`);
  }

  const paths = (images ?? []).map(
    (row) => (row as { storage_path: string }).storage_path,
  );

  const { data: deleted, error: deleteError } = await supabase
    .from("notes")
    .delete()
    .in("id", ids)
    .select("id");

  if (deleteError) {
    throw new Error(`Could not clear the archive: ${deleteError.message}`);
  }

  if (paths.length > 0) {
    // Not fatal, exactly as in `deleteNote`: the notes are gone, which is what was
    // asked. Reporting a Storage failure as "could not clear the archive" would
    // describe the wrong outcome to someone whose notes have in fact been deleted.
    await supabase.storage.from(IMAGE_BUCKET).remove(paths);
  }

  return (deleted ?? []).length;
}

/** Moves a note into a collection, or out of every collection when null. */
export async function setNoteCollection(
  noteId: string,
  collectionId: string | null,
): Promise<void> {
  const supabase = await createClient();

  // `updated_at` is maintained by a database trigger — never set it here.
  const { data, error } = await supabase
    .from("notes")
    .update({ collection_id: collectionId })
    .eq("id", noteId)
    .select("id");

  if (error) {
    if (isForeignCollection(error)) {
      throw new UserFacingError(
        "Could not move note: that collection does not exist, or belongs to another account.",
      );
    }

    throw new Error(`Could not move note: ${error.message}`);
  }

  assertWriteHit(data, "move that note");
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
  const { data, error } = await supabase
    .from("notes")
    .update({ pinned })
    .eq("id", noteId)
    .select("id");

  if (error) {
    throw new Error(`Could not ${pinned ? "pin" : "unpin"} note: ${error.message}`);
  }

  assertWriteHit(data, pinned ? "pin that note" : "unpin that note");
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
  const { data, error } = await supabase
    .from("notes")
    .update({ archived })
    .eq("id", noteId)
    .select("id");

  const verb = archived ? "archive" : "restore";

  if (error) {
    throw new Error(`Could not ${verb} note: ${error.message}`);
  }

  assertWriteHit(data, `${verb} that note`);
}

/**
 * Attaches a tag to a note, creating the tag on first use.
 *
 * `tags` carries `unique (user_id, name)`, so an existing name is a conflict
 * rather than a new row: the tag is looked up first and only inserted when
 * genuinely new. The `note_tags` insert tolerates duplicates because its
 * composite primary key already makes a second identical link impossible.
 *
 * **Matching ignores case.** Typing "work" on one note and "Work" on another used to
 * create two tags that looked identical, drew the same colour, and filtered to
 * disjoint sets of notes — the filter panel showed two pills the user could not tell
 * apart. The first spelling wins and later ones reuse it; a unique index on
 * `(user_id, lower(name))` holds the same line in the database, so a second casing
 * cannot arrive from anywhere else either.
 */
export async function addTagToNote(noteId: string, name: string): Promise<void> {
  const supabase = await createClient();
  const trimmed = name.trim();

  if (!trimmed) return;

  // Every tag the user has, matched case-insensitively in JS rather than with
  // `ilike`: a tag named "a_b" or "50%" would turn into a wildcard pattern there and
  // match the wrong row. RLS already scopes this to one user's tags, and that list is
  // small enough that the comparison costs nothing.
  const { data: owned, error: lookupError } = await supabase
    .from("tags")
    .select("id, name");

  if (lookupError) {
    throw new Error(`Could not look up tag "${trimmed}": ${lookupError.message}`);
  }

  const folded = trimmed.toLocaleLowerCase();
  const existing = ((owned ?? []) as { id: string; name: string }[]).find(
    (tag) => tag.name.toLocaleLowerCase() === folded,
  );

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
      // The lookup above found no such tag, so a unique violation here means
      // another tab created it in between. `addTagToNoteAction` returns rather
      // than throws precisely so this race is recoverable in a line of text, and
      // retrying now takes the `existing` branch — so it needs a sentence the
      // user can act on, not the generic fallback. Mirrors `createTag`.
      if (insertError.code === "23505") {
        throw new UserFacingError(
          `The tag "${trimmed}" was just created somewhere else — add it again.`,
        );
      }

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

/**
 * Detaches a tag from a note. The tag itself is left in place.
 *
 * One of three writes here that deliberately skip `assertWriteHit`, because removing
 * a link that is already gone is the same outcome the caller asked for. Guarding it
 * would turn an impatient double-click into "that tag no longer exists" — an error
 * about a state the user was trying to reach. The other two are the search-history
 * deletes, for the same reason.
 */
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
 * Creates a tag on its own, attached to no note.
 *
 * Until the tag manager existed a tag could only be born from `addTagToNote`, which
 * meant naming your categories required a note to hang them on. This is the same
 * insert without that detour.
 *
 * The duplicate check is left to the database rather than done with a lookup first,
 * unlike `addTagToNote`. That function *wants* an existing tag and reuses it, so it
 * has to look; here a name already in use is a mistake to report, and the unique
 * indexes on `(user_id, name)` and `(user_id, lower(name))` answer it without a race
 * between the check and the insert.
 *
 * No colour means the name picks one, which keeps a tag created here consistent with
 * one created from a note.
 */
export async function createTag(name: string, color?: string): Promise<void> {
  const supabase = await createClient();
  const trimmed = name.trim();

  if (!trimmed) {
    throw new UserFacingError("A tag needs a name.");
  }

  if (color !== undefined && !(TAG_COLORS as readonly string[]).includes(color)) {
    throw new UserFacingError("That is not one of the tag colours.");
  }

  const { error } = await supabase
    .from("tags")
    .insert({ name: trimmed, color: color ?? pickTagColor(trimmed) })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new UserFacingError(`You already have a tag called "${trimmed}".`);
    }
    throw new Error(`Could not create tag "${trimmed}": ${error.message}`);
  }
}

/**
 * Renames a tag and/or changes its colour. Both fields are optional, so the caller
 * can send only what the user actually altered.
 *
 * One update rather than a helper per field: the sidebar's tag editor commits a name
 * and a colour together, and splitting it would mean two round trips that can half
 * succeed.
 *
 * The colour is checked against `TAG_COLORS` here because the column carries a
 * `check` constraint listing the same six names. Letting a bad value through would
 * surface as Postgres error 23514 — accurate, but not something to show a user.
 *
 * A rename can collide: `tags` is unique on `(user_id, name)` and, since case
 * folding landed, also on `(user_id, lower(name))`. Renaming "work" to "Personal"
 * while "personal" exists is therefore a 23505 rather than a silent merge. Changing
 * only the casing of the tag's own name is fine — the conflicting row is itself.
 */
export async function updateTag(
  id: string,
  changes: { name?: string; color?: string },
): Promise<void> {
  const supabase = await createClient();

  const patch: { name?: string; color?: TagColor } = {};

  if (changes.name !== undefined) {
    const trimmed = changes.name.trim();
    if (!trimmed) {
      throw new UserFacingError("A tag needs a name.");
    }
    patch.name = trimmed;
  }

  if (changes.color !== undefined) {
    if (!(TAG_COLORS as readonly string[]).includes(changes.color)) {
      throw new UserFacingError("That is not one of the tag colours.");
    }
    patch.color = changes.color as TagColor;
  }

  // Nothing to write. Sending an empty patch would update zero columns and then
  // trip the read-back guard, reporting a missing tag for a no-op.
  if (Object.keys(patch).length === 0) return;

  const { data, error } = await supabase
    .from("tags")
    .update(patch)
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      // A colour-only update has no name to quote, and cannot collide on one:
      // both unique indexes are on the name. Guarded anyway, because this string
      // is now blessed as user-facing text and `called "undefined"` would ship.
      throw new UserFacingError(
        patch.name
          ? `You already have a tag called "${patch.name}".`
          : "You already have a tag with that name.",
      );
    }
    throw new Error(`Could not update tag: ${error.message}`);
  }

  assertWriteHit(data, "update that tag");
}

/**
 * Deletes a tag outright, removing it from every note that carries it.
 *
 * `note_tags.tag_id` is `on delete cascade`, so the join rows go with it and the
 * notes themselves are untouched — this unfiles them, it does not delete anything
 * the user wrote.
 *
 * Guarded with `assertWriteHit`, unlike `removeTagFromNote`. That one tolerates a
 * missing row because unlinking something already unlinked is the state the caller
 * wanted; this is a deliberate, confirmed, irreversible action, so a stale id is
 * worth reporting rather than silently calling done.
 */
export async function deleteTag(id: string): Promise<void> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(`Could not delete tag: ${error.message}`);
  }

  assertWriteHit(data, "delete that tag");
}

/**
 * The share token for one collection, or null when it is private.
 *
 * Split out of `getCollections` so the token travels only when the share menu is
 * actually open — see the `Collection` type for why the list carries a boolean
 * instead. RLS scopes the select, so an id belonging to someone else finds no row
 * and returns null, which is the same answer a private collection gives: the menu
 * shows the same thing either way, and there is nothing here to distinguish for a
 * caller who should not have asked.
 *
 * No `assertWriteHit` — this is a read, and finding nothing is an answer rather
 * than a write that silently matched no rows.
 */
export async function getCollectionShareToken(
  id: string,
): Promise<string | null> {
  // `.eq` on a uuid column raises 42P02 on a malformed value, which would surface
  // as a failure rather than as "no such collection". The id reaches here from a
  // client component, so it is checked the same way the share token is.
  if (!UUID_PATTERN.test(id)) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("collections")
    .select("share_token")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load the share link: ${error.message}`);
  }

  return data?.share_token ?? null;
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

  const { data, error } = await supabase
    .from("collections")
    .update({ share_token: token })
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(`Could not share collection: ${error.message}`);
  }

  // Read back before handing the token to the caller. Without this a write that
  // matched nothing still returns a token, and the user copies a link that exists
  // nowhere in the database — a share that looks like it worked and 404s forever.
  assertWriteHit(data, "share that collection");

  return token;
}

/** Revokes sharing. Every link handed out for this collection stops working. */
export async function unshareCollection(id: string): Promise<void> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("collections")
    .update({ share_token: null })
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(`Could not stop sharing collection: ${error.message}`);
  }

  assertWriteHit(data, "stop sharing that collection");
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
  // The token arrives straight from the URL, and the function's parameter is a
  // uuid: anything else makes Postgres raise 22P02, which would surface as a 500
  // where the route means to render a 404. A malformed token is not a different
  // kind of failure from an unknown one — nobody holds a link like that either.
  if (!UUID_PATTERN.test(token)) return null;

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

/**
 * A note's images, oldest first, each with a signed URL that can render it.
 *
 * Two steps rather than one, because the rows are in Postgres and the files are in
 * Storage: select the rows RLS allows, then ask Storage to sign exactly those paths.
 * The bucket is private, so an unsigned URL renders nothing — that is what keeps an
 * attachment as private as the note holding it.
 *
 * A path that fails to sign is dropped rather than thrown: one missing file should
 * cost that thumbnail, not the whole note page.
 */
export async function getNoteImages(noteId: string): Promise<SignedNoteImage[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("note_images")
    .select(NOTE_IMAGE_COLUMNS)
    .eq("note_id", noteId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load note images: ${error.message}`);
  }

  const images = (data ?? []) as NoteImage[];
  if (images.length === 0) return [];

  const { data: signed, error: signError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(
      images.map((image) => image.storage_path),
      SIGNED_URL_TTL_SECONDS,
    );

  if (signError) {
    throw new Error(`Could not sign image URLs: ${signError.message}`);
  }

  // Paired by path, not by position. `createSignedUrls` answers in order today and
  // reports per-path failures in each row's own `error` field, but pairing on the
  // index would silently mis-align `id` with `url` if that ever stopped holding —
  // and a mis-aligned URL means the delete button removes a different image than the
  // one the user is looking at.
  const urlByPath = new Map(
    (signed ?? []).flatMap((row) =>
      row.path && row.signedUrl ? [[row.path, row.signedUrl] as const] : [],
    ),
  );

  return images.flatMap((image) => {
    const url = urlByPath.get(image.storage_path);
    return url ? [{ ...image, url }] : [];
  });
}

/**
 * Uploads an image and attaches it to a note.
 *
 * `userId` is passed in rather than looked up here: the caller is a Server Action
 * that has already called `requireUser()`, and asking the Auth server twice for the
 * same answer would be a wasted round trip. It is also what the object path is built
 * from, and the storage policy checks that first path segment against `auth.uid()` —
 * so a mismatched id fails in the database rather than uploading somewhere it should
 * not.
 *
 * The row is written *after* the file lands. If that insert fails the object is
 * removed again, because a file with no row is invisible to the app and impossible
 * to clean up through it.
 */
export async function addNoteImage(
  noteId: string,
  userId: string,
  file: File,
): Promise<void> {
  // Checked before anything is uploaded, and before `path` is built from it.
  // `noteId` is a Server Action argument, so it is whatever the caller sent, and it
  // is interpolated straight into the object key below. Without this the bytes land
  // in Storage first and the row insert is what rejects them — leaving the upload
  // to be undone by the cleanup further down, which is a worse place to depend on
  // than never having written. Same `UUID_PATTERN` as `getSharedCollection` and
  // `getCollectionShareToken`, though not for their reason: those guard a read and
  // answer `null`, where this one guards a path and has to refuse.
  if (!UUID_PATTERN.test(noteId)) {
    throw new UserFacingError("That note does not exist.");
  }

  const extension = imageExtension(file.type);

  if (!extension) {
    throw new UserFacingError("Images must be PNG, JPEG, WebP or GIF.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new UserFacingError("Images must be 5 MB or smaller.");
  }

  if (file.size === 0) {
    throw new UserFacingError("That file is empty.");
  }

  const supabase = await createClient();

  // A fresh uuid rather than the uploaded filename: two photos called IMG_0001.jpg
  // must not collide, and a name from the client has no business becoming a path.
  const path = `${userId}/${noteId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    throw new Error(`Could not upload image: ${uploadError.message}`);
  }

  const { error } = await supabase.from("note_images").insert({
    note_id: noteId,
    storage_path: path,
    mime_type: file.type,
    size_bytes: file.size,
  });

  if (error) {
    // Nothing references the object now, so leaving it would strand it for good.
    // If even the cleanup fails, say so in the same breath rather than reporting a
    // tidy failure over an untidy one.
    const { error: cleanupError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .remove([path]);

    if (cleanupError) {
      throw new Error(
        `Could not attach image: ${error.message}. The uploaded file could not be removed either — ${cleanupError.message}`,
      );
    }

    throw new Error(`Could not attach image: ${error.message}`);
  }
}

/**
 * Detaches an image and deletes its file.
 *
 * The path is read back first — RLS scopes that select, so an id belonging to
 * someone else finds nothing and the function stops before touching Storage.
 */
export async function deleteNoteImage(id: string): Promise<void> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("note_images")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not find that image: ${error.message}`);
  }

  if (!data) {
    throw new UserFacingError("Could not delete image: it no longer exists.");
  }

  const path = (data as { storage_path: string }).storage_path;

  // File first. A row with no file renders one broken thumbnail; a file with no row
  // cannot be reached or removed by anything in the app.
  const { error: storageError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .remove([path]);

  if (storageError) {
    throw new Error(`Could not delete image file: ${storageError.message}`);
  }

  const { error: rowError } = await supabase
    .from("note_images")
    .delete()
    .eq("id", id);

  if (rowError) {
    throw new Error(`Could not delete image: ${rowError.message}`);
  }
}

/**
 * The Storage paths of a note's images.
 *
 * Read by `deleteNote` before it deletes the row, because the `note_images` cascade
 * takes that knowledge with it — a cascade Storage knows nothing about.
 */
async function imagePathsForNote(noteId: string): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("note_images")
    .select("storage_path")
    .eq("note_id", noteId);

  if (error) {
    throw new Error(`Could not list the note's images: ${error.message}`);
  }

  return (data ?? []).map(
    (row) => (row as { storage_path: string }).storage_path,
  );
}
