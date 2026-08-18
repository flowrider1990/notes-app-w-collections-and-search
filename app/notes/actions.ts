"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/db/auth";
import {
  addNoteImage,
  addTagToNote,
  clearSearchHistory,
  createCollection,
  createNote,
  createTag,
  deleteArchivedNotes,
  deleteNote,
  deleteNoteImage,
  deleteTag,
  recordSearch,
  removeSearchHistoryEntry,
  removeTagFromNote,
  renameCollection,
  searchNotes,
  setNoteArchived,
  setNoteCollection,
  setNotePinned,
  shareCollection,
  unshareCollection,
  updateNote,
  updateTag,
  type Note,
} from "@/lib/db";

/**
 * Server Actions for every workspace mutation. Each one delegates to `lib/db`
 * and holds no query of its own.
 *
 * Every action opens with `await requireUser()`. A Server Action is a POST endpoint
 * that anyone holding its id can call, and the page gate does not cover it — RLS
 * would deny the write, but only after the request has been let through, and a
 * denied query returns "could not save" rather than sending the visitor to sign in.
 *
 * That call always sits **before** the `try`, never inside it. `requireUser()`
 * redirects by throwing, and every `catch` in this file turns a throw into
 * `{ error }` — catching the redirect would swallow it and report the internal
 * `NEXT_REDIRECT` marker to the user as a failure message.
 *
 * All of them revalidate with the "layout" type. The workspace data — notes,
 * collections and tags — is fetched in `app/notes/layout.tsx`, and the default
 * "page" type would refresh only `/notes` itself, leaving the sidebar and any
 * open `/notes/[id]` route showing stale content.
 */

const WORKSPACE_PATH = "/notes";

function revalidateWorkspace() {
  revalidatePath(WORKSPACE_PATH, "layout");
}

/**
 * Naming a collection can fail on the `unique (user_id, name)` constraint, and a
 * throw from a Server Action escalates to an error boundary — losing the whole
 * sidebar over a typo. Both naming actions return the message instead so the
 * caller can show it beside the input.
 */
export type ActionResult = { error: string | null };

function failure(cause: unknown, fallback: string): ActionResult {
  return { error: cause instanceof Error ? cause.message : fallback };
}

/**
 * Creates an empty note and hands back its id so the caller can open it.
 *
 * Returns the id rather than redirecting here. `redirect()` works by throwing, and
 * the `catch` below would treat that as a failed create and report the internal
 * `NEXT_REDIRECT` marker as an error message — the same trap the guards avoid.
 * Navigation belongs to the component that knows where the user should land.
 */
export async function createNoteAction(
  collectionId: string | null = null,
): Promise<{ error: string | null; id: string | null }> {
  await requireUser();

  let note: Note;

  try {
    note = await createNote(collectionId);
  } catch (cause) {
    return { ...failure(cause, "Could not create the note."), id: null };
  }

  revalidateWorkspace();
  return { error: null, id: note.id };
}

/**
 * Saves a note's title and body.
 *
 * Trims neither: leading whitespace in a body is often deliberate, and a title the
 * user padded is theirs to pad. Empty is allowed too — `title` and `body` are
 * `not null default ''`, and a note with no title renders as "(untitled)".
 */
export async function updateNoteAction(
  id: string,
  title: string,
  body: string,
): Promise<ActionResult> {
  await requireUser();

  try {
    await updateNote(id, { title, body });
  } catch (cause) {
    return failure(cause, "Could not save the note.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Deletes a note permanently. Archiving is the reversible option — see
 * `setNoteArchivedAction`.
 */
export async function deleteNoteAction(id: string): Promise<ActionResult> {
  await requireUser();

  try {
    await deleteNote(id);
  } catch (cause) {
    return failure(cause, "Could not delete the note.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Deletes every archived note in one go.
 *
 * Returns the count so the sidebar can say what happened — "Deleted 4 notes" is worth
 * more than a list that silently got shorter, especially for an action with no undo.
 */
export async function clearArchiveAction(): Promise<
  ActionResult & { deleted: number }
> {
  await requireUser();

  let deleted = 0;

  try {
    deleted = await deleteArchivedNotes();
  } catch (cause) {
    return { ...failure(cause, "Could not clear the archive."), deleted: 0 };
  }

  revalidateWorkspace();
  return { error: null, deleted };
}

export async function createCollectionAction(name: string): Promise<ActionResult> {
  await requireUser();

  const trimmed = name.trim();
  if (!trimmed) return { error: "A collection needs a name." };

  try {
    await createCollection(trimmed);
  } catch (cause) {
    return failure(cause, "Could not create collection.");
  }

  revalidateWorkspace();
  return { error: null };
}

export async function renameCollectionAction(
  id: string,
  name: string,
): Promise<ActionResult> {
  await requireUser();

  const trimmed = name.trim();
  if (!trimmed) return { error: "A collection needs a name." };

  try {
    await renameCollection(id, trimmed);
  } catch (cause) {
    return failure(cause, "Could not rename collection.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Moves a note into a collection, or out of all of them with `null`.
 *
 * Returns its failure for the same reason the naming actions do: a note is also
 * moved by dropping a card onto a collection in the sidebar, and a throw there
 * would trade a failed move for the entire sidebar unmounting into an error
 * boundary. `collection-picker.tsx` ignores the return value and is unaffected.
 */
export async function setNoteCollectionAction(
  noteId: string,
  collectionId: string | null,
): Promise<ActionResult> {
  await requireUser();

  try {
    await setNoteCollection(noteId, collectionId);
  } catch (cause) {
    return failure(cause, "Could not move the note.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Pins or unpins a note. Returns its failure rather than throwing, for the same
 * reason as the actions above: the control sits on a sidebar card, and a throw
 * would take the whole sidebar down with it.
 */
export async function setNotePinnedAction(
  noteId: string,
  pinned: boolean,
): Promise<ActionResult> {
  await requireUser();

  try {
    await setNotePinned(noteId, pinned);
  } catch (cause) {
    return failure(cause, pinned ? "Could not pin the note." : "Could not unpin the note.");
  }

  revalidateWorkspace();
  return { error: null };
}

/** Archives a note, or restores it from the Archive when `archived` is false. */
export async function setNoteArchivedAction(
  noteId: string,
  archived: boolean,
): Promise<ActionResult> {
  await requireUser();

  try {
    await setNoteArchived(noteId, archived);
  } catch (cause) {
    return failure(
      cause,
      archived ? "Could not archive the note." : "Could not restore the note.",
    );
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Full-text search. A read rather than a mutation, which is unusual for this file,
 * so: the sidebar is a client component and the workspace data is fetched in
 * `app/notes/layout.tsx` — and layouts are not given `searchParams`, because they
 * do not re-render on navigation and the value would go stale. A `?q=` parameter
 * therefore cannot reach the fetch, and the client has to ask for results.
 *
 * No revalidation: nothing changed.
 *
 * `null` means the query held nothing searchable, which the caller renders as "no
 * search active" rather than "no matches".
 */
export async function searchNotesAction(
  query: string,
): Promise<{ error: string | null; notes: Note[] | null }> {
  await requireUser();

  try {
    return { error: null, notes: await searchNotes(query) };
  } catch (cause) {
    return { ...failure(cause, "Could not search notes."), notes: null };
  }
}

/**
 * Shares a collection and hands back the token so the caller can show the link.
 * Returns the token instead of the plain `ActionResult` the other actions use.
 */
export async function shareCollectionAction(
  id: string,
): Promise<{ error: string | null; token: string | null }> {
  await requireUser();

  let token: string;

  try {
    token = await shareCollection(id);
  } catch (cause) {
    return { ...failure(cause, "Could not share the collection."), token: null };
  }

  revalidateWorkspace();
  return { error: null, token };
}

/** Revokes sharing, invalidating every link already handed out. */
export async function unshareCollectionAction(id: string): Promise<ActionResult> {
  await requireUser();

  try {
    await unshareCollection(id);
  } catch (cause) {
    return failure(cause, "Could not stop sharing the collection.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Records a search in the history.
 *
 * Called only when a search is committed — Enter, or picking a suggestion — never
 * on the debounce tick. Search fires per keystroke, and a database write per
 * keystroke is not defensible.
 */
export async function recordSearchAction(query: string): Promise<ActionResult> {
  await requireUser();

  const trimmed = query.trim();
  if (!trimmed) return { error: null };

  try {
    await recordSearch(trimmed);
  } catch (cause) {
    return failure(cause, "Could not save the search.");
  }

  revalidateWorkspace();
  return { error: null };
}

export async function removeSearchHistoryEntryAction(
  query: string,
): Promise<ActionResult> {
  await requireUser();

  try {
    await removeSearchHistoryEntry(query);
  } catch (cause) {
    return failure(cause, "Could not remove the search.");
  }

  revalidateWorkspace();
  return { error: null };
}

export async function clearSearchHistoryAction(): Promise<ActionResult> {
  await requireUser();

  try {
    await clearSearchHistory();
  } catch (cause) {
    return failure(cause, "Could not clear the search history.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Attaches an uploaded image to a note.
 *
 * Takes `FormData` because that is how a file reaches a Server Action — the bytes are
 * multipart, not a serialisable argument. `next.config.ts` raises the action body
 * limit to 6mb for the same reason: the default 1MB would reject most photographs
 * before any of this code ran.
 *
 * The user comes from `requireUser()`, whose id becomes the first segment of the
 * object path. The storage policy checks that segment against `auth.uid()`, so the
 * path cannot be aimed at another user's folder.
 */
export async function uploadNoteImageAction(
  noteId: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { error: "No file was received." };
  }

  try {
    await addNoteImage(noteId, user.id, file);
  } catch (cause) {
    return failure(cause, "Could not attach the image.");
  }

  revalidateWorkspace();
  return { error: null };
}

/** Detaches an image from its note and deletes the file behind it. */
export async function deleteNoteImageAction(id: string): Promise<ActionResult> {
  await requireUser();

  try {
    await deleteNoteImage(id);
  } catch (cause) {
    return failure(cause, "Could not delete the image.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Attaches a tag, creating it if this is its first use.
 *
 * Returns its failure like every other action here. These two used to throw, which
 * escalated to an error boundary and took the note page down over something as
 * ordinary as two tabs adding the same tag at once — a `23505` race that the tag
 * editor can report in a line of text and recover from without losing anything.
 */
export async function addTagToNoteAction(
  noteId: string,
  name: string,
): Promise<ActionResult> {
  await requireUser();

  const trimmed = name.trim();
  if (!trimmed) return { error: null };

  try {
    await addTagToNote(noteId, trimmed);
  } catch (cause) {
    return failure(cause, "Could not add the tag.");
  }

  revalidateWorkspace();
  return { error: null };
}

/** Detaches a tag from a note. The tag itself survives. */
export async function removeTagFromNoteAction(
  noteId: string,
  tagId: string,
): Promise<ActionResult> {
  await requireUser();

  try {
    await removeTagFromNote(noteId, tagId);
  } catch (cause) {
    return failure(cause, "Could not remove the tag.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Creates a tag with no note attached, from the sidebar's tag manager.
 *
 * Returns its failure like the other naming actions: a duplicate name is an ordinary
 * outcome the form can show beside its input, and throwing would take the sidebar
 * down with it.
 */
export async function createTagAction(
  name: string,
  color?: string,
): Promise<ActionResult> {
  await requireUser();

  const trimmed = name.trim();
  if (!trimmed) return { error: "A tag needs a name." };

  try {
    await createTag(trimmed, color);
  } catch (cause) {
    return failure(cause, "Could not create the tag.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Renames a tag and/or recolours it, everywhere it appears.
 *
 * Returns its failure rather than throwing for the same reason the collection
 * rename does: this runs from the sidebar, and a throw there would replace the whole
 * workspace with an error boundary over a duplicate name the user can simply retype.
 */
export async function updateTagAction(
  id: string,
  changes: { name?: string; color?: string },
): Promise<ActionResult> {
  await requireUser();

  if (changes.name !== undefined && !changes.name.trim()) {
    return { error: "A tag needs a name." };
  }

  try {
    await updateTag(id, changes);
  } catch (cause) {
    return failure(cause, "Could not update the tag.");
  }

  revalidateWorkspace();
  return { error: null };
}

/**
 * Deletes a tag and, by cascade, its links to every note. The notes are untouched.
 */
export async function deleteTagAction(id: string): Promise<ActionResult> {
  await requireUser();

  try {
    await deleteTag(id);
  } catch (cause) {
    return failure(cause, "Could not delete the tag.");
  }

  revalidateWorkspace();
  return { error: null };
}
