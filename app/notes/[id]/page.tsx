import { Suspense } from "react";
import { notFound } from "next/navigation";

import { CollectionPicker } from "@/components/notes/collection-picker";
import { DeleteNote } from "@/components/notes/delete-note";
import { NoteEditor } from "@/components/notes/note-editor";
import { NoteImages } from "@/components/notes/note-images";
import { NoteSkeleton } from "@/components/notes/note-skeleton";
import { TagEditor } from "@/components/notes/tag-editor";
import { getCollections, getNote, getNoteImages } from "@/lib/db";
import { requireUser } from "@/lib/db/auth";

type NotePageProps = {
  params: Promise<{ id: string }>;
};

/**
 * The note itself: title and body in an editor, then its collection, its tags, its
 * images, and the delete control.
 *
 * The text is editable client-side while everything below the rule is a separate
 * control writing straight through its own Server Action — so a note's metadata
 * changes without going near the unsaved state of the editor above it.
 *
 * Images are fetched here rather than in the component because their URLs are signed
 * server-side against the owner's session; the bucket is private, so an unsigned URL
 * renders nothing. Each visit mints fresh ones.
 */
async function NoteDetail({ params }: NotePageProps) {
  const { id } = await params;
  await requireUser();

  const [note, collections, images] = await Promise.all([
    getNote(id),
    getCollections(),
    getNoteImages(id),
  ]);

  // A missing note and a note owned by someone else are indistinguishable
  // through RLS, and both should read as "not found".
  if (!note) notFound();

  return (
    <article className="flex max-w-2xl flex-col gap-8">
      {/* Keyed by id so switching notes resets the editor's state. Without it
          React reuses the component across the navigation and the previous note's
          unsaved text would appear under the new note's title. */}
      <NoteEditor
        key={note.id}
        noteId={note.id}
        initialTitle={note.title}
        initialBody={note.body}
      >
        <hr />

        <CollectionPicker
          noteId={note.id}
          collections={collections}
          currentCollectionId={note.collection_id}
        />

        <TagEditor noteId={note.id} tags={note.tags} />

        <NoteImages noteId={note.id} images={images} />
      </NoteEditor>

      <hr />

      <DeleteNote noteId={note.id} title={note.title} />
    </article>
  );
}

/**
 * `params` is per-request data, so awaiting it has to happen inside the Suspense
 * boundary — the promise is handed to the child rather than unwrapped here, or
 * `cacheComponents` would refuse to prerender the route.
 */
export default function NotePage({ params }: NotePageProps) {
  return (
    <Suspense fallback={<NoteSkeleton />}>
      <NoteDetail params={params} />
    </Suspense>
  );
}
