"use server";

import { revalidatePath } from "next/cache";

import {
  addTagToNote,
  createCollection,
  removeTagFromNote,
  setNoteCollection,
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

export async function createCollectionAction(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;

  await createCollection(trimmed);
  revalidateWorkspace();
}

export async function setNoteCollectionAction(
  noteId: string,
  collectionId: string | null,
) {
  await setNoteCollection(noteId, collectionId);
  revalidateWorkspace();
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
