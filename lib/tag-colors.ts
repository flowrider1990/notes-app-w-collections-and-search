/**
 * The tag colour palette, shared by the data layer and the UI.
 *
 * Deliberately free of server imports: `lib/db/index.ts` needs `pickTagColor`
 * and client components need the class maps, so pulling
 * `@/lib/supabase/server` in here would drag the server client into the browser
 * bundle.
 *
 * The names must stay in step with the `tags_color_check` constraint in
 * `docs/schema.sql` — the database rejects anything else. Widened from six to
 * ten by supabase/migrations/20260818120415_expand_tag_palette.sql.
 */

/**
 * Ordered by hue, so the swatch row in the tag manager reads as a spectrum rather
 * than an arbitrary set. `slate` leads because it is the neutral and the column
 * default.
 */
export const TAG_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/**
 * Class names are spelled out per colour rather than built by interpolation.
 * Tailwind scans source for literal classes, so `bg-${color}-100` would compile
 * to nothing.
 */
const PILL_CLASSES: Record<TagColor, string> = {
  slate:
    "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100",
  red: "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  // Orange and amber take the 900 text weight: their 100 backgrounds are the
  // lightest in the set, and 800 does not clear 4.5:1 on them.
  orange:
    "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200",
  amber:
    "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  green:
    "border-green-300 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
  teal: "border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200",
  blue: "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  indigo:
    "border-indigo-300 bg-indigo-100 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  violet:
    "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
  pink: "border-pink-300 bg-pink-100 text-pink-800 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-200",
};

const DOT_CLASSES: Record<TagColor, string> = {
  slate: "bg-slate-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

function normalise(color: string): TagColor {
  return (TAG_COLORS as readonly string[]).includes(color)
    ? (color as TagColor)
    : "slate";
}

/** Border, background and text classes for a tag pill. */
export function tagPillClasses(color: string): string {
  return PILL_CLASSES[normalise(color)];
}

/** Background class for the small colour dot on a pill. */
export function tagDotClasses(color: string): string {
  return DOT_CLASSES[normalise(color)];
}

/**
 * Picks a stable colour for a new tag from its name, so the same name always
 * lands on the same colour and repeated palettes stay balanced across tags.
 */
export function pickTagColor(name: string): TagColor {
  const key = name.trim().toLowerCase();

  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }

  // `>>> 0` rather than Math.abs: the most negative 32-bit int has no positive
  // counterpart and would slip through as a negative index.
  return TAG_COLORS[(hash >>> 0) % TAG_COLORS.length];
}
