"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ImagePlus, X } from "lucide-react";

import {
  deleteNoteImageAction,
  uploadNoteImageAction,
} from "@/app/notes/actions";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * What a thumbnail needs: something to key and delete by, and something to render.
 *
 * Not `SignedNoteImage`, which is the database row plus a URL. That row's
 * `storage_path` opens with the owner's auth uid — `{user_id}/{note_id}/{uuid}.{ext}`
 * — so typing this prop as the row put a user id in the payload of every note view,
 * alongside three more columns nothing here reads. The signed `url` is the only
 * handle on a file this component has any use for, and it expires.
 *
 * `storage_path?: never` states the exclusion rather than merely omitting it: a
 * narrower prop type accepts a wider object, so leaving the field out would not
 * have stopped the row being passed again. Naming the field is also the guard's
 * limit — it refuses this column, not extra fields in general.
 */
type NoteImageThumbnail = {
  id: string;
  url: string;
  storage_path?: never;
};

type NoteImagesProps = {
  noteId: string;
  images: NoteImageThumbnail[];
};

/** Mirrors the bucket's `allowed_mime_types`, so the picker offers only what will be accepted. */
const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";

/**
 * Mirrors the bucket's `file_size_limit`, and checked here as well as on the server
 * for a reason that is not politeness: an oversized file exceeds the Server Action
 * body limit, so the request fails in the transport rather than returning
 * `{ error }`. Without this the note page falls into an error boundary instead of
 * telling the user their photo is too big.
 */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The open note's image attachments: a picker, and a grid of what is already
 * attached.
 *
 * The files live in a private Storage bucket, so each thumbnail renders through a
 * short-lived signed URL minted on the server — that is why `images` arrives as a
 * prop rather than being fetched here. Reopening the note mints fresh URLs.
 *
 * Uploading goes through a Server Action rather than the browser talking to Storage
 * directly: it keeps the Supabase client out of this component, and it makes the
 * upload and the database row a single call that either works or reports why.
 */
export function NoteImages({ noteId, images }: NoteImagesProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setError(null);

    if (file.size > MAX_BYTES) {
      setError("Images must be 5 MB or smaller.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      // Caught rather than left to reject: a network drop or a body-limit rejection
      // never reaches the action, so there is no `{ error }` to read, and an
      // unhandled rejection here takes the whole note page into an error boundary.
      try {
        const result = await uploadNoteImageAction(noteId, formData);
        if (result.error) setError(result.error);
      } catch {
        setError("The upload did not go through. Check the file and try again.");
      }
    });
  }

  function remove(id: string) {
    setError(null);

    startTransition(async () => {
      try {
        const result = await deleteNoteImageAction(id);
        if (result.error) setError(result.error);
      } catch {
        setError("Could not delete the image. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Images</SectionLabel>

      {images.length > 0 ? (
        <ul className="grid grid-cols-3 gap-3">
          {images.map((image) => (
            <li key={image.id} className="group relative">
              {/* Fixed aspect box with `fill`: the intrinsic size of an attachment is
                  not known here, and a grid that reflows as each thumbnail loads is
                  worse than one that never moves. */}
              <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                <Image
                  src={image.url}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 33vw, 200px"
                  className="object-cover"
                />
              </div>

              {/* Always visible, unlike the hover-revealed controls on note cards.
                  Deleting an image cannot be undone, and a hover-only control is
                  invisible on a touch screen — where the first tap that reveals it
                  would be the tap that fires it. */}
              <button
                type="button"
                onClick={() => remove(image.id)}
                disabled={pending}
                aria-label="Delete image"
                className="absolute right-1.5 top-1.5 rounded-md border bg-background/90 p-1 shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No images attached to this note yet.
        </p>
      )}

      {/* The real input stays hidden: a bare file input cannot be styled to match
          the rest of the app, and a button that opens the picker can. */}
      <input
        ref={input}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
          // Cleared so picking the same file twice in a row still fires a change.
          event.target.value = "";
        }}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={16} aria-hidden />
        {pending ? "Working…" : "Add image"}
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
