import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * `lib/db/index.ts` is `server-only` and every function in it opens a Supabase
 * client, so it cannot be imported here. What these tests check is the part that
 * does not need one: the pattern `addNoteImage` validates `noteId` against, read
 * out of the file itself, and the order the guard sits in — which is the whole
 * security property. An upload that happens before the check and is undone
 * afterwards is the thing being prevented, and only the ordering prevents it.
 */
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/** The body of one top-level `export async function`, by brace matching. */
function functionBody(name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in lib/db/index.ts`);

  const open = source.indexOf("{", start);
  let depth = 1;
  let i = open + 1;

  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") depth -= 1;
    i += 1;
  }

  return source.slice(open + 1, i - 1);
}

describe("the UUID_PATTERN addNoteImage validates against", () => {
  // No dotAll flag — the project targets ES2017 and it is not needed: the literal
  // holds no whitespace, and the `\s*` before it already crosses the line break.
  const declaration = source.match(
    /const UUID_PATTERN\s*=\s*(\/\S+\/)([a-z]*);/,
  );

  assert.ok(declaration, "UUID_PATTERN declaration not found");

  const pattern = new RegExp(
    declaration[1].slice(1, -1),
    declaration[2],
  );

  it("accepts a real note id, in either case", () => {
    assert.ok(pattern.test("50fc4137-b300-4a95-8c5f-ba68dd238e47"));
    assert.ok(pattern.test("50FC4137-B300-4A95-8C5F-BA68DD238E47"));
  });

  it("rejects anything carrying a path separator", () => {
    // The finding's own example: a noteId that walks out of the caller's prefix.
    for (const value of [
      "../../11111111-1111-1111-1111-111111111111",
      "..",
      "../",
      "a/b",
      "50fc4137-b300-4a95-8c5f-ba68dd238e47/..",
      "/50fc4137-b300-4a95-8c5f-ba68dd238e47",
      "50fc4137-b300-4a95-8c5f-ba68dd238e47/x",
    ]) {
      assert.ok(!pattern.test(value), `accepted: ${value}`);
    }
  });

  it("rejects the empty string and near-misses", () => {
    for (const value of [
      "",
      "   ",
      "not-a-uuid",
      "50fc4137b3004a958c5fba68dd238e47",
      "50fc4137-b300-4a95-8c5f-ba68dd238e4",
      "50fc4137-b300-4a95-8c5f-ba68dd238e477",
      "50fc4137-b300-4a95-8c5f-ba68dd238e4g",
      "50fc4137-b300-4a95-8c5f-ba68dd238e47\n",
    ]) {
      assert.ok(!pattern.test(value), `accepted: ${value}`);
    }
  });
});

describe("addNoteImage", () => {
  const body = functionBody("addNoteImage");

  // Matched *with* the negation. Searching for `UUID_PATTERN.test(noteId)` alone
  // would match an inverted guard just as happily — `if (UUID_PATTERN.test(noteId))
  // throw` rejects every valid upload and admits every invalid one, and would have
  // kept all four of these tests green.
  const guard = body.indexOf("!UUID_PATTERN.test(noteId)");
  const pathBuilt = body.indexOf("${userId}/${noteId}/");
  const upload = body.indexOf(".upload(");

  it("rejects rather than accepts on a pattern match", () => {
    assert.notEqual(
      guard,
      -1,
      "no negated UUID_PATTERN check on noteId — it either reaches the object key unvalidated, or the guard is inverted",
    );
  });

  it("throws on a bad noteId rather than carrying on", () => {
    const afterGuard = body.slice(guard, guard + 200);
    assert.match(afterGuard, /throw new UserFacingError\(/);
  });

  it("validates before the object key is built from noteId", () => {
    assert.notEqual(pathBuilt, -1, "the object key no longer interpolates noteId");
    assert.ok(
      guard < pathBuilt,
      "noteId is interpolated into the storage key before it is validated",
    );
  });

  /**
   * The one that matters. If the guard ever moves below the upload, an invalid id
   * writes bytes to Storage and then depends on the cleanup path to remove them —
   * which is exactly the failure mode the fix exists to remove.
   */
  it("validates before any bytes are uploaded", () => {
    assert.notEqual(upload, -1, "the upload call moved or was renamed");
    assert.ok(
      guard < upload,
      "an invalid noteId can still reach Storage before being rejected",
    );
  });
});
