/**
 * Turns what the user typed into a Postgres `tsquery` string.
 *
 * No imports on purpose — this is pure string work, callable from the data layer
 * without dragging a Supabase client along.
 *
 * **Why sanitising is not optional.** `to_tsquery` parses its input, and the
 * characters `& | ! ( ) : * < >` are operators. Passing raw text through means a
 * lone apostrophe or a stray colon raises Postgres `42601` — a syntax error, not
 * an empty result — so search would break on punctuation rather than quietly find
 * nothing. Reducing the input to alphanumeric tokens removes the whole class of
 * failure instead of escaping character by character.
 *
 * **Why the trailing `:*`.** Full-text search matches whole words: with the
 * stemmer, "shopping" is indexed as "shop", so typing "shopp" would find nothing
 * until the word was complete. `:*` makes the final token a prefix match, which is
 * what keeps search-as-you-type usable. Only the last token gets it — the earlier
 * words have been typed out already.
 */
export function toTsQuery(input: string): string | null {
  // Unicode-aware: `\p{L}` keeps umlauts and accents, which a bare [a-z0-9]
  // would strip out of a word like "Bäume" and turn into two useless tokens.
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);

  // No usable tokens — the caller falls back to the unfiltered list rather than
  // running a query that cannot match anything.
  if (tokens.length === 0) return null;

  const last = tokens.length - 1;
  return tokens.map((token, i) => (i === last ? `${token}:*` : token)).join(" & ");
}
