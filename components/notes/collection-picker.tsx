"use client";

import { useTransition } from "react";
import { ChevronDown } from "lucide-react";

import { setNoteCollectionAction } from "@/app/notes/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Collection } from "@/lib/db";

type CollectionPickerProps = {
  noteId: string;
  collections: Collection[];
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
      <p className="text-xs font-semibold uppercase text-muted-foreground">
        Collection
      </p>

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
