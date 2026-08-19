import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSharePath } from "./share-path.ts";

/**
 * The share-namespace test used by `lib/supabase/proxy.ts` to decide which paths a
 * signed-out visitor may reach.
 *
 * Run with `npm test`.
 *
 * The `/shared-admin` and `/sharexyz` cases are why this file exists: the previous
 * check was `startsWith("/share")`, which matched them. No such route existed, so
 * nothing leaked — but the exemption would have widened silently the first time one
 * was added, without anything in the diff looking like an auth change.
 */
const CASES: ReadonlyArray<{ path: string; shared: boolean; why: string }> = [
  // Inside the namespace: exempt from the login redirect.
  { path: "/share/abc-123", shared: true, why: "a share link" },
  { path: "/share/", shared: true, why: "the namespace root with a slash" },
  { path: "/share", shared: true, why: "the namespace root" },

  // Outside it: these must still be redirected to the login page.
  { path: "/shared-admin", shared: false, why: "a lookalike route" },
  { path: "/sharexyz", shared: false, why: "a lookalike with no separator" },
  { path: "/shared/abc", shared: false, why: "a lookalike with a child path" },
  { path: "/notes", shared: false, why: "the workspace" },
  { path: "/notes/share/abc", shared: false, why: "share appearing mid-path" },
  { path: "/", shared: false, why: "the landing page" },
  { path: "", shared: false, why: "an empty path" },
];

describe("isSharePath", () => {
  for (const { path, shared, why } of CASES) {
    it(`${shared ? "exempts" : "does not exempt"} ${why} — ${JSON.stringify(path)}`, () => {
      assert.equal(isSharePath(path), shared);
    });
  }
});

/**
 * The property the predicate exists to provide: nothing outside the `/share`
 * namespace may be exempt. Stated separately from the table so a future rewrite that
 * loosens the match — back to a prefix, or to a regex that forgets its anchor — fails
 * here even for an input nobody thought to list.
 */
describe("isSharePath exempts only the share namespace", () => {
  const suffixes = ["", "-admin", "xyz", "d", "d/abc", "//evil.com"];

  for (const suffix of suffixes) {
    const path = `/share${suffix}`;

    it(`decides ${JSON.stringify(path)} by segment`, () => {
      // Exempt only when what follows "/share" is nothing at all, or a separator.
      const expected = suffix === "" || suffix.startsWith("/");
      assert.equal(isSharePath(path), expected);
    });
  }
});
