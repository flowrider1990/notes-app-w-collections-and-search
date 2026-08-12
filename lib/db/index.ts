import { createClient } from "@/lib/supabase/server";
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
  created_at: string;
};

export type Note = {
  id: string;
  collection_id: string | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  tags: Tag[];
};

const NOTE_COLUMNS =
  "id, collection_id, title, body, created_at, updated_at, note_tags(tags(id, name, color))";

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
 * Every note the signed-in user owns, newest first, each with its tags.
 *
 * Tags come from the same round trip rather than a query per note — a nested
 * select here is the difference between one statement and N+1.
 */
export async function getNotes(): Promise<Note[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load notes: ${error.message}`);
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
    .select("id, name, created_at")
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
    .select("id, name, created_at")
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
