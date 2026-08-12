import { Suspense } from "react";

import { requireUser } from "@/lib/db/auth";
import { getNotes } from "@/lib/db/notes";

/**
 * Split out from the page so the shell can still be prerendered. Cache
 * Components is enabled, and reading notes touches `cookies()` for the session,
 * which is per-request data — that has to sit behind a Suspense boundary or the
 * whole route becomes unprerenderable.
 */
async function NotesList() {
  await requireUser();
  const notes = await getNotes();

  if (notes.length === 0) {
    return <p>No notes yet.</p>;
  }

  return (
    <>
      <p className="text-sm">{notes.length} notes</p>
      <ul className="flex flex-col gap-4">
        {notes.map((note) => (
          <li key={note.id} className="flex flex-col gap-1 border rounded p-4">
            <h2 className="font-semibold">{note.title || "(untitled)"}</h2>
            <p className="whitespace-pre-wrap text-sm">{note.body}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function NotesPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-6">
      <h1 className="font-bold text-2xl">Notes</h1>

      <Suspense fallback={<p>Loading notes…</p>}>
        <NotesList />
      </Suspense>
    </div>
  );
}
