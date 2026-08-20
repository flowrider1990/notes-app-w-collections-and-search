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

/**
 * The same text with comments removed, so an assertion about what the code does is
 * not satisfied — or defeated — by prose that merely mentions it. The `[^:]` guard
 * keeps a `//` inside a URL from being read as a comment. Crude, and only ever used
 * to make a negative assertion stricter.
 */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*/g, "$1");
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
  const canonicalised = body.indexOf("const canonicalNoteId = noteId.toLowerCase()");
  const pathBuilt = body.indexOf("${userId}/${canonicalNoteId}/");
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
    assert.notEqual(
      pathBuilt,
      -1,
      "the object key no longer interpolates the canonicalised note id",
    );
    assert.ok(
      guard < pathBuilt,
      "noteId is interpolated into the storage key before it is validated",
    );
  });

  /**
   * The storage policy compares the note-id segment against `notes.id::text`, which
   * Postgres renders lowercase, while `UUID_PATTERN` carries the `i` flag and admits
   * either case. Without this step an uppercase id passes validation, goes verbatim
   * into the key, and is then refused by the policy — the app and the database
   * disagreeing about the same path. It has to happen after the guard (so the value
   * is known to be a uuid) and before the key (so the key gets the canonical form).
   */
  it("canonicalises noteId between validating it and building the key", () => {
    assert.notEqual(
      canonicalised,
      -1,
      "noteId is no longer lower-cased, so an uppercase id would build a key the storage policy refuses",
    );
    assert.ok(guard < canonicalised, "noteId is canonicalised before it is validated");
    assert.ok(
      canonicalised < pathBuilt,
      "the object key is built before noteId is canonicalised",
    );
  });

  /**
   * The format decision must be made from the bytes, and must be what reaches
   * Storage. These are source assertions for the same reason as the ordering ones:
   * `detectImageFormat` is pure and cannot be fooled by a declared type, so nothing
   * a unit test does to it would notice `contentType: file.type` coming back at the
   * call site — which is exactly the mistake that shipped once already.
   */
  it("consults the file's bytes and never its declared type", () => {
    assert.ok(
      body.includes("detectImageFormat("),
      "addNoteImage no longer detects the format from the file's bytes",
    );
    assert.ok(
      !codeOf(body).includes("file.type"),
      "addNoteImage reads file.type again — the declared type decides nothing here",
    );
  });

  it("detects the format before uploading, and uploads the detected type", () => {
    const detected = body.indexOf("detectImageFormat(");
    const upload = body.indexOf(".upload(");

    assert.ok(detected !== -1 && upload !== -1);
    assert.ok(detected < upload, "bytes are uploaded before the format is checked");

    // supabase-js drops the `contentType` option when the body is a Blob, so the
    // body itself has to carry the detected type. Without this the object is stored
    // and served as whatever the uploader declared.
    const wrapped = body.indexOf("type: format.mime");
    assert.ok(
      wrapped !== -1,
      "the upload body no longer carries the detected type, so Storage will use the declared one",
    );
    assert.ok(wrapped < upload, "the body is wrapped after it is uploaded");
    assert.ok(
      body.includes("${format.extension}"),
      "the object key extension no longer comes from the detected format",
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
