/**
 * The right-hand pane before a note is chosen. Reads nothing, so it stays a
 * fully static shell while the sidebar streams in beside it.
 */
export default function NotesIndexPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">
        Select a note from the sidebar to view it.
      </p>
    </div>
  );
}
