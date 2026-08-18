"use client";

import { useId, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  createTagAction,
  deleteTagAction,
  updateTagAction,
} from "@/app/notes/actions";
import { TagPill } from "@/components/notes/tag-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import type { Tag } from "@/lib/db";
import { pickTagColor, TAG_COLORS, tagDotClasses } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

type TagManagerProps = {
  tags: Tag[];
  /** Notes carrying each tag, by tag id — what a delete is about to unfile. */
  usage: Map<string, number>;
  /** Tag ids the filter is currently narrowing by, so the rows still show it. */
  selectedTagIds: string[];
  /** Lets the sidebar drop a deleted tag from the active filter. */
  onDeleted: (tagId: string) => void;
};

/**
 * The workspace's tag manager: create a tag, rename one, change its colour, delete
 * one. Everything that is about the tags themselves rather than about which tags a
 * note carries — that stays in the note editor's `TagEditor`.
 *
 * It lives in the sidebar rather than on a route of its own because this project does
 * not add pages (see CLAUDE.md), and because every other workspace-level control —
 * collections, search, theme, sign-out — is already here.
 *
 * It replaces the filter pills rather than decorating them: a filter pill is a
 * `<button>`, and a control inside a button is invalid markup. Managing is therefore
 * a mode the Tags section switches into. A row keeps its filter ring while in that
 * mode, so switching never hides the fact that a filter is narrowing the list below.
 */
export function TagManager({
  tags,
  usage,
  selectedTagIds,
  onDeleted,
}: TagManagerProps) {
  return (
    <div className="flex flex-col gap-2">
      <NewTag />

      <ul className="flex flex-col gap-1">
        {tags.map((tag) => (
          <li key={tag.id}>
            <TagRow
              tag={tag}
              noteCount={usage.get(tag.id) ?? 0}
              selected={selectedTagIds.includes(tag.id)}
              onDeleted={onDeleted}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The ten-colour palette as a real radio group.
 *
 * Radios rather than styled buttons: a colour is one choice out of ten, so the
 * arrow-key behaviour and the single-selection semantics should come from the
 * browser instead of from a `role="radio"` that would have to reimplement them. The
 * visible swatch is the label; the colour name is its accessible text.
 *
 * `groupName` has to be unique per form on the page — two radio groups sharing a
 * name would fight over one selection.
 */
function ColorChoice({
  groupName,
  value,
  onChange,
}: {
  groupName: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const labelId = useId();

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <SectionLabel id={labelId}>Colour</SectionLabel>

      {/* Ten swatches do not fit one line in a 320px sidebar, so they wrap. */}
      <div className="flex flex-wrap gap-1.5">
        {TAG_COLORS.map((color) => (
          <label key={color} className="cursor-pointer">
            <input
              type="radio"
              name={groupName}
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                "block h-6 w-6 rounded-full transition",
                tagDotClasses(color),
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                value === color
                  ? "ring-2 ring-foreground/40 ring-offset-2 ring-offset-background"
                  : "opacity-60 hover:opacity-100",
              )}
            />
            <span className="sr-only">{color}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Creates a tag attached to nothing.
 *
 * Two states rather than a dialog, following `NewCollection`: the button becomes the
 * form in place. No dialog primitive is installed, and a name and a colour do not
 * warrant one.
 *
 * The swatch selection follows what you type until you touch it. A tag created from a
 * note takes a colour hashed from its name, so previewing that here means the picker
 * shows the colour you are actually about to get rather than an arbitrary default —
 * and clicking a swatch pins your own choice instead.
 */
function NewTag() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chosenColor = color ?? pickTagColor(name);

  function close() {
    setName("");
    setColor(null);
    setError(null);
    setOpen(false);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const result = await createTagAction(trimmed, chosenColor);

      if (result.error) {
        // The name stays put so a duplicate can be corrected rather than retyped.
        setError(result.error);
        return;
      }

      close();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={() => setOpen(true)}
      >
        <Plus size={16} className="mr-1" aria-hidden />
        New tag
      </Button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2 rounded-md border bg-background p-2"
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Tag name"
        aria-label="Tag name"
        className="h-8"
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      />

      <ColorChoice groupName="new-tag-color" value={chosenColor} onChange={setColor} />

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending ? "Adding…" : "Add tag"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={close}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

type RowMode = "idle" | "editing" | "confirming";

/** How many notes lose the tag, said in words the sentence can use. */
function describeUsage(noteCount: number): string {
  if (noteCount === 0) return "It is not on any notes.";
  if (noteCount === 1) return "It will be removed from 1 note.";
  return `It will be removed from ${noteCount} notes.`;
}

function TagRow({
  tag,
  noteCount,
  selected,
  onDeleted,
}: {
  tag: Tag;
  noteCount: number;
  selected: boolean;
  onDeleted: (tagId: string) => void;
}) {
  const [mode, setMode] = useState<RowMode>("idle");
  const [draftName, setDraftName] = useState(tag.name);
  const [draftColor, setDraftColor] = useState<string>(tag.color);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function beginEdit() {
    setDraftName(tag.name);
    setDraftColor(tag.color);
    setError(null);
    setMode("editing");
  }

  function cancel() {
    setDraftName(tag.name);
    setDraftColor(tag.color);
    setError(null);
    setMode("idle");
  }

  function save() {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError("A tag needs a name.");
      return;
    }

    // Only what actually changed. An unchanged name is still a write, and a write
    // revalidates the whole workspace.
    const changes: { name?: string; color?: string } = {};
    if (trimmed !== tag.name) changes.name = trimmed;
    if (draftColor !== tag.color) changes.color = draftColor;

    if (Object.keys(changes).length === 0) {
      cancel();
      return;
    }

    startTransition(async () => {
      const result = await updateTagAction(tag.id, changes);

      if (result.error) {
        // The draft stays in the box so a rejected name can be corrected rather
        // than retyped.
        setError(result.error);
        return;
      }

      setError(null);
      setMode("idle");
    });
  }

  function remove() {
    setError(null);

    startTransition(async () => {
      const result = await deleteTagAction(tag.id);

      if (result.error) {
        setError(result.error);
        setMode("idle");
        return;
      }

      // The tag is gone; a filter still naming it would narrow to nothing with no
      // pill left to explain why.
      onDeleted(tag.id);
    });
  }

  if (mode === "editing") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-2 rounded-md border bg-background p-2"
      >
        <Input
          autoFocus
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          aria-label={`Rename tag ${tag.name}`}
          className="h-8"
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
          }}
        />

        <ColorChoice
          groupName={`tag-color-${tag.id}`}
          value={draftColor}
          onChange={setDraftColor}
        />

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancel}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  if (mode === "confirming") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2">
        <p className="text-sm">
          Delete <strong>{tag.name}</strong>? {describeUsage(noteCount)} The notes
          themselves stay.
        </p>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={remove}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode("idle")}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <TagPill tag={tag} selected={selected} className="max-w-full" />
        </div>

        {/* Mono and tabular, like the collection counts: instrumentation, and it
            should not shift the controls beside it when 9 becomes 10. A zero here is
            worth seeing — it is a tag nothing uses. */}
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {noteCount}
        </span>

        {/* Always visible, unlike the pin and archive controls on a note card: the
            user switched into this mode in order to reach them. */}
        <button
          type="button"
          onClick={beginEdit}
          className="icon-button"
          aria-label={`Edit tag ${tag.name}`}
        >
          <Pencil size={14} aria-hidden />
        </button>

        <button
          type="button"
          onClick={() => setMode("confirming")}
          className="icon-button text-destructive hover:bg-destructive/10"
          aria-label={`Delete tag ${tag.name}`}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
