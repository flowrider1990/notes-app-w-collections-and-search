"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { createCollectionAction } from "@/app/notes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Requirement 7: create a named collection straight from the sidebar.
 *
 * The button reveals an inline input and submitting creates the collection
 * immediately. Deliberately no dialog or modal system — that would mean a new
 * dependency for what a single text field already does.
 */
export function NewCollection() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    startTransition(async () => {
      // `collections` is unique per (user_id, name), so a duplicate is a likely
      // and recoverable outcome — shown inline rather than thrown.
      const result = await createCollectionAction(trimmed);

      if (result.error) {
        setError(result.error);
        return;
      }

      setError(null);
      setName("");
      setOpen(false);
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
        New collection
      </Button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2"
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Collection name"
        aria-label="Collection name"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setName("");
            setError(null);
            setOpen(false);
          }
        }}
      />

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setName("");
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
