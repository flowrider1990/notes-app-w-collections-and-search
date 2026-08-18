/**
 * The right-hand pane before a note is chosen. Reads nothing, so it stays a
 * fully static shell while the sidebar streams in beside it.
 *
 * Two versions of the same sentence, swapped by breakpoint rather than by state:
 * below `md` there is no sidebar on screen to select from, so pointing at one is
 * an instruction the reader cannot follow.
 */
export default function NotesIndexPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-balance text-center text-sm text-muted-foreground">
        <span className="hidden md:inline">
          Select a note from the sidebar to view it.
        </span>
        <span className="md:hidden">
          Open the notes list from the top bar to pick a note.
        </span>
      </p>
    </div>
  );
}
