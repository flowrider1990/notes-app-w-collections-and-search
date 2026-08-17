"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";

import { addTagToNoteAction, removeTagFromNoteAction } from "@/app/notes/actions";
import { TagPill } from "@/components/notes/tag-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import type { Tag } from "@/lib/db";

type TagEditorProps = {
  noteId: string;
  tags: Tag[];
};

/** Add and remove the open note's tags. Typing an existing name reuses that tag. */
export function TagEditor({ noteId, tags }: TagEditorProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addTag() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);

    startTransition(async () => {
      const result = await addTagToNoteAction(noteId, trimmed);

      if (result.error) {
        // The typed name stays in the box, so a failure can be retried rather than
        // retyped. Clearing it on failure would look like the tag was added.
        setError(result.error);
        return;
      }

      setName("");
    });
  }

  function removeTag(tagId: string) {
    setError(null);

    startTransition(async () => {
      const result = await removeTagFromNoteAction(noteId, tagId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Tags</SectionLabel>

      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This note has no tags yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <TagPill key={tag.id} tag={tag} className="pr-1">
              <button
                type="button"
                onClick={() => removeTag(tag.id)}
                disabled={pending}
                aria-label={`Remove tag ${tag.name}`}
                className="ml-1 rounded hover:bg-background/40 disabled:opacity-50"
              >
                <X size={12} aria-hidden />
              </button>
            </TagPill>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          addTag();
        }}
        className="flex gap-2"
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Add a tag"
          aria-label="Add a tag"
          className="max-w-xs"
        />
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Add"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
