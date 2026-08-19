import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AFTER_SIGN_IN_PATH, safeNextPath } from "./auth-redirect.ts";

/**
 * The guard on `?next=`, which both `/auth/callback` and `/auth/confirm` hand a string
 * that arrived from an email or an OAuth provider.
 *
 * Run with `npm test`. No test framework is installed — this uses the runner built into
 * Node, so the suite costs the project no dependency.
 *
 * Two suites read the same table below. The second one is the important one: it asserts
 * the property the guard exists to provide, over every input listed, so a case added
 * here is covered by both without being enumerated twice.
 */
const ORIGIN = "http://localhost:3000";

const CASES: ReadonlyArray<{
  next: string | null;
  expected: string;
  why: string;
}> = [
  // Allowed: same-origin destinations, returned as a relative path.
  { next: "/notes", expected: "/notes", why: "a plain relative path" },
  {
    next: "/notes/abc?tab=tags#top",
    expected: "/notes/abc?tab=tags#top",
    why: "a relative path with query and hash",
  },
  {
    next: "http://localhost:3000/notes?tab=tags",
    expected: "/notes?tab=tags",
    why: "a same-origin absolute URL, reduced to its path",
  },

  // Rejected: the string starts with a single slash but a browser reads the authority
  // out of it, because `\` is `/` in an http(s) URL.
  {
    next: "/\\evil.com",
    expected: AFTER_SIGN_IN_PATH,
    why: "a backslash lookalike",
  },
  {
    next: "/\\/evil.com",
    expected: AFTER_SIGN_IN_PATH,
    why: "a backslash-slash lookalike",
  },

  // Rejected: resolves to *this* origin, so the origin check alone passes — but
  // normalises to the pathname `//evil.com`, which a browser reads as protocol-relative
  // and follows off-origin. This is the class the first fix missed.
  {
    next: "/.//evil.com",
    expected: AFTER_SIGN_IN_PATH,
    why: "a dot segment hiding a protocol-relative path",
  },
  {
    next: "/..//evil.com",
    expected: AFTER_SIGN_IN_PATH,
    why: "a parent segment hiding a protocol-relative path",
  },
  {
    next: "http://localhost:3000//evil.com",
    expected: AFTER_SIGN_IN_PATH,
    why: "a same-origin absolute URL with a doubled path slash",
  },

  // Rejected: plainly off-origin.
  { next: "//evil.com", expected: AFTER_SIGN_IN_PATH, why: "a protocol-relative URL" },
  {
    next: "https://evil.com/steal",
    expected: AFTER_SIGN_IN_PATH,
    why: "an absolute external URL",
  },
  {
    next: "https://localhost:3000/notes",
    expected: AFTER_SIGN_IN_PATH,
    why: "the same host on another scheme",
  },
  {
    next: "http://localhost:4000/notes",
    expected: AFTER_SIGN_IN_PATH,
    why: "the same host on another port",
  },
  {
    next: "javascript:alert(1)",
    expected: AFTER_SIGN_IN_PATH,
    why: "a non-http scheme",
  },

  // Falls back rather than erroring.
  { next: null, expected: AFTER_SIGN_IN_PATH, why: "an absent next" },
  { next: "", expected: AFTER_SIGN_IN_PATH, why: "an empty next" },
];

describe("safeNextPath returns the expected destination", () => {
  for (const { next, expected, why } of CASES) {
    it(`${why} — ${JSON.stringify(next)}`, () => {
      assert.equal(safeNextPath(next, ORIGIN), expected);
    });
  }
});

/**
 * The property the guard exists to provide, and the primary assertion of this file:
 * whatever it returns, resolved the way a browser resolves a `Location:` header, must
 * land back on exactly the application origin.
 *
 * Stating it this way rather than as a list of known-bad strings is deliberate. Both
 * bugs this file was written for — the backslash prefix bypass, and the `//evil.com`
 * pathname that survived the origin check — passed an enumeration of the lookalikes
 * known at the time. A rewrite that reintroduces either fails here.
 */
describe("safeNextPath always resolves back to the application origin", () => {
  for (const { next, why } of CASES) {
    it(`${why} — ${JSON.stringify(next)}`, () => {
      const result = safeNextPath(next, ORIGIN);

      assert.equal(
        new URL(result, ORIGIN).origin,
        ORIGIN,
        `${JSON.stringify(result)} leaves the origin when resolved as a Location header`,
      );

      // The same fact stated at the string level, so a failure names the cause rather
      // than only the symptom.
      assert.ok(
        !result.startsWith("//"),
        `${JSON.stringify(result)} is protocol-relative`,
      );
    });
  }
});
