import { Suspense } from "react";
import { notFound } from "next/navigation";

import { CollectionPicker } from "@/components/notes/collection-picker";
import { TagEditor } from "@/components/notes/tag-editor";
import { getCollections, getNote } from "@/lib/db";
import { requireUser } from "@/lib/db/auth";

type NotePageProps = {
  params: Promise<{ id: string }>;
};

/**
 * Title and body are read-only here — this pass covers assigning a collection
 * and editing tags, not authoring text.
 */
async function NoteDetail({ params }: NotePageProps) {
  const { id } = await params;
  await requireUser();

  const [note, collections] = await Promise.all([getNote(id), getCollections()]);

  // A missing note and a note owned by someone else are indistinguishable
  // through RLS, and both should read as "not found".
  if (!note) notFound();

  return (
    <article className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{note.title || "(untitled)"}</h1>
      </header>

      {note.body ? (
        <p className="whitespace-pre-wrap">{note.body}</p>
      ) : (
        <p className="text-sm text-muted-foreground">This note has no body.</p>
      )}

      <hr />

      <CollectionPicker
        noteId={note.id}
        collections={collections}
        currentCollectionId={note.collection_id}
      />

      <TagEditor noteId={note.id} tags={note.tags} />
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
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">Loading note…</p>}
    >
      <NoteDetail params={params} />
    </Suspense>
  );
}
