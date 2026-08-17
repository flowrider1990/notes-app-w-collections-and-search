/**
 * Turns a note into the Markdown file a user downloads, and into the name that
 * file arrives under.
 *
 * No imports on purpose, like `lib/search-query.ts`: this is pure string work, so
 * it can be reasoned about and exercised on its own without a Supabase client or a
 * browser anywhere near it. The component that calls these does the `Blob` and
 * `<a download>` part, which is the only bit that needs a DOM.
 */

/** Longest slug before the extension. Long enough to stay recognisable, short
 *  enough that no filesystem or download panel truncates it awkwardly. */
const MAX_SLUG_LENGTH = 60;

/**
 * The file's contents: an H1 for the title, a blank line, then the body exactly as
 * it was typed.
 *
 * The body is plain text and is emitted verbatim — no escaping, no reflowing. If
 * someone wrote Markdown into it by hand, it stays Markdown; if they wrote prose,
 * it stays prose. Guessing at their intent would be the one thing that could
 * corrupt a file they are trying to keep.
 *
 * An untitled note exports as body alone: a bare `# ` heading is not a title, it is
 * a broken one.
 */
export function toMarkdown(note: { title: string; body: string }): string {
  const title = note.title.trim();
  const body = note.body.trim();

  const parts = [];
  if (title) parts.push(`# ${title}`);
  if (body) parts.push(body);

  // A single trailing newline, as a text file should end.
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : "";
}

/**
 * A filename derived from the title: `Shopping list` becomes `shopping-list.md`.
 *
 * Unicode-aware for the same reason `toTsQuery` is — splitting on `[^a-z0-9]`
 * would turn "Bäume" into "b" and "ume" and lose the word. Accented letters
 * survive the slug; the text inside the file is untouched either way.
 *
 * Titles that carry no letters or digits at all — `!!!`, or nothing — fall back to
 * `untitled.md` rather than producing a file called `.md`, which is a hidden file
 * on Unix and rejected outright on Windows.
 */
export function markdownFilename(title: string): string {
  const tokens = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return "untitled.md";

  // Built up token by token so the cap lands on a word boundary: a slug cut
  // mid-word reads like a mistake.
  let slug = "";
  for (const token of tokens) {
    const candidate = slug ? `${slug}-${token}` : token;
    if (candidate.length > MAX_SLUG_LENGTH) break;
    slug = candidate;
  }

  // One very long first token: cut it rather than fall back to "untitled", which
  // would tell the user nothing about which note they just downloaded.
  if (!slug) slug = tokens[0].slice(0, MAX_SLUG_LENGTH);

  return `${slug}.md`;
}
