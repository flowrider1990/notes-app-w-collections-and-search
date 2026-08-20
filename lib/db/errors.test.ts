import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { UserFacingError, clientErrorMessage } from "./errors.ts";

const FALLBACK = "Could not save the note.";

/**
 * The messages `lib/db/` actually produces, quoted verbatim from the Postgres text
 * `supabase-js` puts in `error.message`. These are the strings the finding was
 * about: before the split, a Server Action returned them to the browser.
 */
const LEAKY_MESSAGES = [
  'Could not tag note: new row violates row-level security policy for table "note_tags"',
  'Could not save note: permission denied for table "notes"',
  "Could not load notes: JWT expired",
  'Could not create collection "Work": duplicate key value violates unique constraint "collections_user_id_name_key"',
  "Could not search notes: syntax error in tsquery: \"foo &\"",
  'Could not attach image: new row violates row-level security policy for table "note_images"',
  "Could not move note: insert or update on table \"notes\" violates foreign key constraint \"notes_collection_owner_fkey\"",
];

describe("clientErrorMessage", () => {
  it("withholds every raw database message the data layer throws", () => {
    for (const message of LEAKY_MESSAGES) {
      assert.equal(
        clientErrorMessage(new Error(message), FALLBACK),
        FALLBACK,
        `leaked: ${message}`,
      );
    }
  });

  it("keeps the messages written for the user", () => {
    const userFacing = [
      'You already have a collection called "Work".',
      'You already have a tag called "urgent".',
      "A collection needs a name.",
      "A tag needs a name.",
      "That is not one of the tag colours.",
      "Images must be PNG, JPEG, WebP or GIF.",
      "Images must be 5 MB or smaller.",
      "That file is empty.",
      "Could not share that collection: it no longer exists.",
      "Could not delete image: it no longer exists.",
      "Could not create note: that collection does not exist, or belongs to another account.",
    ];

    for (const message of userFacing) {
      assert.equal(
        clientErrorMessage(new UserFacingError(message), FALLBACK),
        message,
      );
    }
  });

  /**
   * The point of failing closed: a throw added to `lib/db/` later is private until
   * somebody deliberately marks it otherwise, rather than public until somebody
   * notices. A plain `Error` is the shape every such throw has today.
   */
  it("falls back for anything that is not a UserFacingError", () => {
    const causes: unknown[] = [
      new Error("permission denied for table \"notes\""),
      new TypeError("fetch failed"),
      new RangeError("nope"),
      "a thrown string",
      null,
      undefined,
      42,
      { message: "I look like an error but am not one" },
      { name: "UserFacingError", message: "forged" },
      Object.assign(new Error("decorated"), { name: "UserFacingError" }),
    ];

    for (const cause of causes) {
      assert.equal(clientErrorMessage(cause, FALLBACK), FALLBACK);
    }
  });

  it("falls back rather than returning an empty error", () => {
    // "" is falsy, so a caller checking `if (result.error)` would read it as
    // success while the action had in fact failed.
    assert.equal(clientErrorMessage(new UserFacingError(""), FALLBACK), FALLBACK);
    assert.equal(
      clientErrorMessage(new UserFacingError("   "), FALLBACK),
      FALLBACK,
    );
  });

  it("returns the fallback verbatim, so each action controls its own wording", () => {
    assert.equal(
      clientErrorMessage(new Error("raw"), "Could not clear the archive."),
      "Could not clear the archive.",
    );
  });
});

describe("UserFacingError", () => {
  it("is an Error, so existing catch blocks still work", () => {
    const error = new UserFacingError("A tag needs a name.");

    assert.ok(error instanceof Error);
    assert.ok(error instanceof UserFacingError);
    assert.equal(error.message, "A tag needs a name.");
    assert.equal(error.name, "UserFacingError");
  });
});

/**
 * The unit tests above prove the *rule*. This proves the rule is applied: the
 * classification in lib/db/index.ts is what decides whether a given failure is
 * private, and nothing in the type system stops someone wrapping an interpolated
 * `error.message` in a `UserFacingError` and publishing it again.
 */
describe("the data layer's classification", () => {
  const source = readFileSync(
    new URL("./index.ts", import.meta.url),
    "utf8",
  );

  /** Every argument list passed to `new UserFacingError(...)`, one per throw. */
  function userFacingArguments(): string[] {
    const found: string[] = [];
    const opener = "new UserFacingError(";
    let at = source.indexOf(opener);

    while (at !== -1) {
      let depth = 1;
      let i = at + opener.length;

      while (i < source.length && depth > 0) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") depth -= 1;
        i += 1;
      }

      found.push(source.slice(at + opener.length, i - 1));
      at = source.indexOf(opener, i);
    }

    return found;
  }

  it("marks some errors user-facing, so the scan below is not vacuous", () => {
    assert.ok(userFacingArguments().length >= 15);
  });

  it("never interpolates a database message into a user-facing error", () => {
    for (const argument of userFacingArguments()) {
      assert.ok(
        !argument.includes(".message"),
        `a UserFacingError quotes a database message: ${argument.trim()}`,
      );
    }
  });

  /**
   * The converse of the test above, and the one that catches the mistake that is
   * easy to make: a message written for the user thrown as a plain `Error`, which
   * now silently becomes the action's generic fallback. Every plain throw in the
   * file must be quoting the database — that is the only reason to be one.
   */
  it("leaves a plain Error only where the database is being quoted", () => {
    const plain: string[] = [];
    const opener = "throw new Error(";
    let at = source.indexOf(opener);

    while (at !== -1) {
      let depth = 1;
      let i = at + opener.length;

      while (i < source.length && depth > 0) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") depth -= 1;
        i += 1;
      }

      plain.push(source.slice(at + opener.length, i - 1));
      at = source.indexOf(opener, i);
    }

    assert.ok(plain.length > 0);

    for (const argument of plain) {
      assert.ok(
        /\$\{[^}]*\.message\}/.test(argument),
        `a plain Error carries no database message, so it may have been meant for the user — mark it UserFacingError or say why: ${argument.trim()}`,
      );
    }
  });
});
