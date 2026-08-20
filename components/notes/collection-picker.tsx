"use client";

import { useTransition } from "react";
import { ChevronDown } from "lucide-react";

import { setNoteCollectionAction } from "@/app/notes/actions";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The two fields this control renders, and deliberately not the `Collection` row
 * they come from.
 *
 * A collection row also carries `share_token` — a bearer capability: whoever holds
 * one reads that collection with no sign-in at all. This is defence in depth rather
 * than a leak closed, and the distinction matters to anyone reasoning from here: the
 * sidebar in `app/notes/layout.tsx` takes unprojected collections and renders those
 * tokens as share links, so they are already in this document's payload on every
 * `/notes/**` route, by design. What this type removes is a second copy, arriving
 * through a control that displays nothing but names.
 *
 * `share_token?: never` is what removes it. Structural typing accepts a wider object
 * wherever a narrower one is expected, so listing the two fields wanted is not on
 * its own a refusal of the rest; naming the field that must be absent makes handing
 * over a whole row a compile error. The guard is per-field and by name, so it holds
 * this one door rather than every door.
 */
type CollectionOption = {
  id: string;
  name: string;
  share_token?: never;
};

type CollectionPickerProps = {
  noteId: string;
  collections: CollectionOption[];
  currentCollectionId: string | null;
};

/**
 * Assigns the open note to a collection, or to none.
 *
 * `notes.collection_id` is nullable so a note can sit outside every collection,
 * which the radio group represents with an empty-string sentinel — the DOM has
 * no way to carry `null` as a value.
 */
const UNCOLLECTED = "";

export function CollectionPicker({
  noteId,
  collections,
  currentCollectionId,
}: CollectionPickerProps) {
  const [pending, startTransition] = useTransition();

  const current =
    collections.find((collection) => collection.id === currentCollectionId) ??
    null;

  function select(value: string) {
    const collectionId = value === UNCOLLECTED ? null : value;
    if (collectionId === currentCollectionId) return;

    startTransition(async () => {
      await setNoteCollectionAction(noteId, collectionId);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Collection</SectionLabel>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* `max-w-sm` matches the tag row below — a `max-w-xs` input plus the Add
              button — so the two controls line up instead of this one running the
              full width of the article. The width comes from a cap rather than a
              fixed size because a flex column stretches its children by default,
              and `justify-between` keeps the chevron on the right edge. */}
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            className="w-full max-w-sm justify-between"
          >
            {current ? current.name : "Uncollected"}
            <ChevronDown size={16} className="ml-1" aria-hidden />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={currentCollectionId ?? UNCOLLECTED}
            onValueChange={select}
          >
            <DropdownMenuRadioItem value={UNCOLLECTED}>
              Uncollected
            </DropdownMenuRadioItem>

            {collections.map((collection) => (
              <DropdownMenuRadioItem key={collection.id} value={collection.id}>
                {collection.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {collections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No collections yet. Create one from the sidebar.
        </p>
      ) : null}
    </div>
  );
}
