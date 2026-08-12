"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";

import { addTagToNoteAction, removeTagFromNoteAction } from "@/app/notes/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tag } from "@/lib/db";

type TagEditorProps = {
  noteId: string;
  tags: Tag[];
};

/** Add and remove the open note's tags. Typing an existing name reuses that tag. */
export function TagEditor({ noteId, tags }: TagEditorProps) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function addTag() {
    const trimmed = name.trim();
    if (!trimmed) return;

    startTransition(async () => {
      await addTagToNoteAction(noteId, trimmed);
      setName("");
    });
  }

  function removeTag(tagId: string) {
    startTransition(async () => {
      await removeTagFromNoteAction(noteId, tagId);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase text-muted-foreground">
        Tags
      </p>

      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This note has no tags yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
              {tag.name}
              <button
                type="button"
                onClick={() => removeTag(tag.id)}
                disabled={pending}
                aria-label={`Remove tag ${tag.name}`}
                className="rounded hover:bg-background/40 disabled:opacity-50"
              >
                <X size={12} aria-hidden />
              </button>
            </Badge>
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
    </div>
  );
}
