"use server";

import { revalidatePath } from "next/cache";

import {
  addTagToNote,
  createCollection,
  removeTagFromNote,
  renameCollection,
  setNoteArchived,
  setNoteCollection,
  setNotePinned,
} from "@/lib/db";

/**
 * Server Actions for every workspace mutation. Each one delegates to `lib/db`
 * and holds no query of its own.
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

export async function createCollectionAction(name: string): Promise<ActionResult> {
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

export async function addTagToNoteAction(noteId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;

  await addTagToNote(noteId, trimmed);
  revalidateWorkspace();
}

export async function removeTagFromNoteAction(noteId: string, tagId: string) {
  await removeTagFromNote(noteId, tagId);
  revalidateWorkspace();
}
