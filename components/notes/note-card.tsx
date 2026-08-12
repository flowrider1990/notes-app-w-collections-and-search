import Link from "next/link";

import { TagPill } from "@/components/notes/tag-pill";
import type { Note } from "@/lib/db";

/** A note as it appears in the sidebar: title, body excerpt, and its tags. */
export function NoteCard({ note }: { note: Note }) {
  return (
    <Link
      href={`/notes/${note.id}`}
      className="block rounded-md border p-3 transition-colors hover:bg-accent"
    >
      <h3 className="font-medium">{note.title || "(untitled)"}</h3>

      {note.body ? (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {note.body}
        </p>
      ) : null}

      {note.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {note.tags.map((tag) => (
            <TagPill key={tag.id} tag={tag} />
          ))}
        </div>
      ) : null}
    </Link>
  );
}
