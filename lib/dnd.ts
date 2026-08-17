/**
 * Drag-and-drop payload keys for moving a note between collections.
 *
 * These live in their own module so the drop target (`collection-group.tsx`)
 * does not have to import from the drag source (`note-card.tsx`) — the group
 * already renders the card, and importing back the other way would be circular.
 *
 * Custom MIME types rather than `text/plain`: `dataTransfer.getData()` is
 * blocked outside the `drop` event in Firefox, so a target cannot inspect the
 * payload while deciding whether to accept one. `dataTransfer.types` *is*
 * readable during `dragover`, so the presence of `NOTE_ID_MIME` is what makes a
 * drag recognisable as a note. Browsers lowercase these keys — keep them lowercase.
 */
export const NOTE_ID_MIME = "application/x-notes-app-note-id";

/**
 * The note's collection at the moment the drag started, so a drop onto the
 * collection it already sits in can be skipped instead of writing and
 * revalidating for nothing. An empty string means the note is uncollected.
 */
export const NOTE_COLLECTION_MIME = "application/x-notes-app-note-collection-id";
