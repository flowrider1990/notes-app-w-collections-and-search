"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { PanelLeft, X } from "lucide-react";

import { LogoutButton } from "@/components/logout-button";
import { NewNote } from "@/components/notes/new-note";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { cn } from "@/lib/utils";

/** Matches Tailwind's `md`. The one number the layout switches on. */
const DESKTOP_QUERY = "(min-width: 768px)";

type WorkspaceShellProps = {
  /** The sidebar's scrolling middle — passed in so the layout can stream it. */
  sidebar: ReactNode;
  children: ReactNode;
};

/**
 * The workspace frame: a sidebar column and the editor beside it.
 *
 * Two layouts, one component. From `md` up it is what it always was — a sticky
 * 320px column a viewport tall, with the note list scrolling between a fixed
 * header and footer. Below `md` the same column becomes an off-canvas drawer over
 * the editor, opened from a top bar, because a 320px pane on a 375px screen left
 * the editor 55px wide.
 *
 * Client-side because the drawer needs state, but the sidebar's *contents* arrive
 * as a prop from the server layout. That keeps the Suspense boundary and the
 * database reads on the server: this component never learns what a note is.
 *
 * Why `matchMedia` as well as Tailwind breakpoints: CSS can move the panel
 * off-screen, but an off-screen panel is still focusable and still read by a
 * screen reader. `inert` is what actually takes it out of the page, and only
 * JavaScript knows which layout is live. It is initialised to desktop so the
 * server-rendered markup is the interactive one and hydration matches.
 */
export function WorkspaceShell({ sidebar, children }: WorkspaceShellProps) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);

    function sync() {
      setDesktop(query.matches);
      // Rotating to landscape mid-drawer would otherwise leave `open` set, and a
      // later rotation back would reopen a drawer nobody asked for.
      if (query.matches) setOpen(false);
    }

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  /**
   * Opening a note from the drawer should reveal the note. Without this the
   * navigation happens behind the panel that triggered it and nothing appears to
   * have changed.
   *
   * Delegated from the container rather than watched with `usePathname`: on a route
   * with a dynamic param the pathname is not known at build time, so that hook
   * suspends and would need a Suspense boundary around this whole frame — whose
   * fallback would blank the workspace. A click that landed on a link is the actual
   * signal, and keyboard activation raises a click too.
   */
  function closeIfNavigating(event: MouseEvent<HTMLDivElement>) {
    if (desktop) return;
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  }

  /** Escape closes, and the page behind stops scrolling while it is covered. */
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  /**
   * Focus follows the panel, so a keyboard or screen reader lands inside it and
   * comes back out to the control that opened it.
   *
   * Guarded on having actually opened once. `desktop` starts true and only turns
   * false after `matchMedia` runs, so without the guard the closed branch fires on
   * first paint on every phone and pulls focus to the menu button before the reader
   * has reached the page.
   */
  const hasOpened = useRef(false);

  useEffect(() => {
    if (desktop) return;

    if (open) {
      hasOpened.current = true;
      closeRef.current?.focus();
    } else if (hasOpened.current) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open, desktop]);

  const drawerOpen = !desktop && open;
  /** Off to the side and out of the page: not focusable, not announced. */
  const drawerHidden = !desktop && !open;

  return (
    <div className="flex min-h-svh w-full flex-col md:flex-row">
      {/* The mobile-only top bar. Sticky rather than fixed so it participates in
          the flow and the editor below it needs no compensating padding. */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-3 backdrop-blur md:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="workspace-sidebar"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <PanelLeft size={18} aria-hidden />
          <span className="sr-only">Show notes</span>
        </button>

        <p className="font-semibold tracking-tight">Notes</p>
      </header>

      {/* Dismiss-by-tapping-away. Rendered only while open, so it never sits over
          the editor on a desktop viewport. */}
      {drawerOpen ? (
        <div
          onClick={() => setOpen(false)}
          aria-hidden
          className="fixed inset-0 z-40 bg-foreground/25 md:hidden"
        />
      ) : null}

      {/* Tinted a shade off the paper so the two panes read as separate surfaces
          without a heavy divider. Header and footer are a fixed height, which
          gives the column a frame and lets the list between them scroll alone.

          No link back to the landing page: it redirects a signed-in visitor here,
          so the trip would end where it started. */}
      <aside
        id="workspace-sidebar"
        inert={drawerHidden || undefined}
        className={cn(
          "z-50 flex w-80 max-w-[85vw] shrink-0 flex-col border-r bg-muted/40",
          // Mobile: a panel pinned to the left edge, slid out of view when shut.
          "fixed bottom-0 left-0 top-0 transition-transform duration-200 ease-out",
          // Desktop: back to a column in the flow, always in view, full height.
          "md:sticky md:bottom-auto md:h-svh md:max-w-none md:translate-x-0 md:transition-none",
          open ? "translate-x-0 shadow-2xl md:shadow-none" : "-translate-x-full",
        )}
      >
        {/* `min-h` rather than a fixed height: New note reports failures inline,
            and a fixed header would clip the message. */}
        <div className="flex min-h-14 shrink-0 flex-col justify-center gap-1.5 border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="flex-1 px-2 font-semibold tracking-tight">Notes</p>

            {/* The primary action, above the scroll area rather than inside it —
                creating a note should not require scrolling back up past the
                search box and the tag filter to find the button. */}
            <NewNote />

            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent md:hidden"
            >
              <X size={18} aria-hidden />
              <span className="sr-only">Hide notes</span>
            </button>
          </div>
        </div>

        <div
          onClick={closeIfNavigating}
          className="flex-1 overflow-y-auto px-5 py-6"
        >
          {sidebar}
        </div>

        <footer className="flex h-14 shrink-0 items-center justify-between border-t px-3">
          <ThemeSwitcher />
          <LogoutButton />
        </footer>
      </aside>

      {/* Inert while the drawer covers it: that is what keeps Tab from walking
          out of the open panel into the page behind it, without a focus trap. */}
      <main
        inert={drawerOpen || undefined}
        className="min-w-0 flex-1 px-6 py-10 md:px-10 md:py-14"
      >
        {children}
      </main>
    </div>
  );
}
