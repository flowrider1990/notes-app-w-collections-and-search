import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CollectionPicker } from "@/components/notes/collection-picker";
import { DeleteNote } from "@/components/notes/delete-note";
import { NoteEditor } from "@/components/notes/note-editor";
import { NoteImages } from "@/components/notes/note-images";
import { NoteSkeleton } from "@/components/notes/note-skeleton";
import { TagEditor } from "@/components/notes/tag-editor";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-redirect";
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

  /**
   * Back to the workspace rather than `notFound()`.
   *
   * Deleting a note revalidates `/notes` as a layout, which re-renders whatever
   * route the user is on — including this one, for the note that was just deleted.
   * That payload arrives before any client-side navigation can, so `notFound()` put
   * a 404 on screen for a delete that had in fact succeeded. Redirecting makes the
   * outcome deterministic instead of a race, and it covers every caller: the card in
   * the sidebar, the button on this page, and a stale bookmark alike.
   *
   * Nothing leaks by redirecting. A missing note and someone else's note are
   * indistinguishable through RLS, so both land here, and `/notes` says nothing about
   * whether the id ever existed.
   */
  if (!note) redirect(AFTER_SIGN_IN_PATH);

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

        {/* Rows projected to the fields each control renders: everything reaching
            a client component is serialized into this page's payload whether or not
            anything draws it. `CollectionOption` and `NoteImageThumbnail` say which
            fields, and why each excludes the one it does. */}
        <CollectionPicker
          noteId={note.id}
          collections={collections.map((collection) => ({
            id: collection.id,
            name: collection.name,
          }))}
          currentCollectionId={note.collection_id}
        />

        <TagEditor noteId={note.id} tags={note.tags} />

        <NoteImages
          noteId={note.id}
          images={images.map((image) => ({ id: image.id, url: image.url }))}
        />
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
