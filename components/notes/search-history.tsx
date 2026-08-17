"use client";

import { useState, useTransition } from "react";
import { Clock, History, Trash2, X } from "lucide-react";

import {
  clearSearchHistoryAction,
  removeSearchHistoryEntryAction,
} from "@/app/notes/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SearchHistoryEntry } from "@/lib/db";

type SearchHistoryProps = {
  entries: SearchHistoryEntry[];
  /** Re-runs a past search. The parent owns the query, so it does the searching. */
  onPick: (query: string) => void;
};

/**
 * Recent searches, offered back for re-running.
 *
 * Built on the already-installed Radix dropdown rather than a new popover
 * dependency. Renders nothing when the history is empty — an empty control is
 * clutter that never becomes useful on its own.
 */
export function SearchHistory({ entries, onPick }: SearchHistoryProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (entries.length === 0) return null;

  function remove(query: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeSearchHistoryEntryAction(query);
      if (result.error) setError(result.error);
    });
  }

  function clearAll() {
    setError(null);
    startTransition(async () => {
      const result = await clearSearchHistoryAction();
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            className="h-7 justify-start px-2 text-xs text-muted-foreground"
          >
            <History size={14} className="mr-1" aria-hidden />
            Recent searches
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          {entries.map((entry) => (
            // A row holding its own remove button, so the two actions do not fight
            // over the same click target.
            <DropdownMenuItem
              key={entry.query}
              onSelect={() => onPick(entry.query)}
              className="flex items-center gap-2"
            >
              <Clock size={14} className="shrink-0 opacity-60" aria-hidden />
              <span className="flex-1 truncate">{entry.query}</span>
              <button
                type="button"
                aria-label={`Remove "${entry.query}" from recent searches`}
                onClick={(event) => {
                  // Without this the dropdown treats the click as picking the row
                  // and re-runs the very search being deleted.
                  event.preventDefault();
                  event.stopPropagation();
                  remove(entry.query);
                }}
                className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
              >
                <X size={12} aria-hidden />
              </button>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={clearAll} className="text-destructive">
            <Trash2 size={14} className="mr-2" aria-hidden />
            Clear all
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
