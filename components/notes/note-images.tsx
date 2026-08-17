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
import type { SignedNoteImage } from "@/lib/db";

type NoteImagesProps = {
  noteId: string;
  images: SignedNoteImage[];
};

/** Mirrors the bucket's `allowed_mime_types`, so the picker offers only what will be accepted. */
const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";

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

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      const result = await uploadNoteImageAction(noteId, formData);
      if (result.error) setError(result.error);
    });
  }

  function remove(id: string) {
    setError(null);

    startTransition(async () => {
      const result = await deleteNoteImageAction(id);
      if (result.error) setError(result.error);
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

              <button
                type="button"
                onClick={() => remove(image.id)}
                disabled={pending}
                aria-label="Delete image"
                className="absolute right-1.5 top-1.5 rounded-md bg-background/90 p-1 opacity-0 shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 disabled:opacity-50 group-hover:opacity-100"
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
