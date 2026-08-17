"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";

import { updateNoteAction } from "@/app/notes/actions";
import { markdownFilename, toMarkdown } from "@/lib/markdown-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Textarea } from "@/components/ui/textarea";

type NoteEditorProps = {
  noteId: string;
  initialTitle: string;
  initialBody: string;
  /**
   * Rendered between the body and the Save button — the note's collection and tag
   * controls. They belong to this component's layout but not to its state: each
   * writes through its own Server Action and saves the moment it is used, so
   * nothing here is waiting on them.
   *
   * They arrive as children because Save has to live below them, and Save cannot
   * leave this component: it is the only thing that knows whether the text is
   * dirty.
   */
  children?: React.ReactNode;
};

/**
 * Authoring a note: a title field, a body field, and an explicit Save.
 *
 * Saving is deliberate rather than automatic. A debounced autosave would need the
 * same stale-response guarding the search box carries, and it makes "did that
 * save?" a question the user has to infer. A button answers it.
 *
 * The body is plain text. CLAUDE.md once described a Markdown preview toggle;
 * rendering Markdown means a new dependency, so that is a later decision rather
 * than something quietly assumed here.
 */
export function NoteEditor({
  noteId,
  initialTitle,
  initialBody,
  children,
}: NoteEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  /**
   * What the database is believed to hold. Tracked here rather than compared
   * against the props: saving revalidates the workspace, which re-renders this
   * component with fresh props but *keeps* its state, so props alone would never
   * clear the dirty flag.
   */
  const [saved, setSaved] = useState({ title: initialTitle, body: initialBody });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = title !== saved.title || body !== saved.body;

  /**
   * Writes the note and reports whether it worked, so Export can refuse to hand
   * over a file that does not match the database.
   */
  async function persist(): Promise<boolean> {
    const result = await updateNoteAction(noteId, title, body);

    if (result.error) {
      // The text stays in the box. Losing an edit to a failed write would be the
      // worst thing this component could do.
      setError(result.error);
      return false;
    }

    // The values captured when this save started, not whatever is in the box now —
    // typing during a save leaves the note correctly dirty again.
    setSaved({ title, body });
    return true;
  }

  function save() {
    if (!dirty) return;

    setError(null);
    startTransition(async () => {
      await persist();
    });
  }

  /**
   * Saves first, then downloads — so the file the user keeps is the note the
   * database holds, not a snapshot of an editor they had not committed.
   *
   * A failed save cancels the download. Handing over a file at that point would be
   * the one outcome worse than no file: it looks like the note was saved.
   */
  function exportMarkdown() {
    setError(null);

    startTransition(async () => {
      if (dirty && !(await persist())) return;

      const markdown = toMarkdown({ title, body });
      const url = URL.createObjectURL(
        new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      );

      // A synthetic link rather than any download helper: this is the whole of it,
      // and a dependency for six lines is not a trade worth making.
      const link = document.createElement("a");
      link.href = url;
      link.download = markdownFilename(title);
      document.body.append(link);
      link.click();
      link.remove();

      // Without this the blob stays in memory for the life of the page.
      URL.revokeObjectURL(url);
    });
  }

  function status() {
    if (pending) return "Saving…";
    if (dirty) return "Unsaved changes";
    return "Saved";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <label htmlFor="note-title" className="sr-only">
          Title
        </label>
        {/* Borderless and unpadded: the title is the page's heading that happens to
            be editable, so it should look like a heading rather than a form field. */}
        <Input
          id="note-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled"
          className="h-auto border-0 px-0 py-0 text-3xl font-semibold tracking-tight shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 md:text-3xl"
        />

        <label htmlFor="note-body" className="sr-only">
          Body
        </label>
        {/* 15px on a 28px line: a reading measure for prose, not the tight rhythm
            of a form control. */}
        <Textarea
          id="note-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write your note…"
          className="min-h-[45vh] resize-y px-4 py-3 text-[15px] leading-7 shadow-none"
        />
      </div>

      {children}

      {/* Last, so it reads as "save this note" rather than "save the body" — the
          collection and tag controls above it save themselves. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save"}
          </Button>

          {/* Outline, so Save stays the only filled button on the page. Enabled
              even with nothing to save — exporting an unchanged note is the
              ordinary case. */}
          <Button
            type="button"
            variant="outline"
            onClick={exportMarkdown}
            disabled={pending}
          >
            <Download size={16} aria-hidden />
            Export .md
          </Button>

          {/* Same mono treatment as the section labels: this is the app reporting
              on the note, not part of the note. */}
          <SectionLabel aria-live="polite">{status()}</SectionLabel>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
