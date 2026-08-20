import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIGNATURE_BYTES,
  detectImageFormat,
} from "./image-signature.ts";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) =>
  new Uint8Array([...text].map((c) => c.charCodeAt(0)));

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** Real leading bytes for each format the app accepts. */
// Signature, then the IHDR chunk: its 4-byte length (13, which is not matched) and
// its type. Every valid PNG starts this way — IHDR is required to be the first chunk.
const PNG_SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PNG = join(PNG_SIGNATURE, bytes(0x00, 0x00, 0x00, 0x0d), ascii("IHDR"));
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
// "RIFF", a four-byte length that is not inspected, then the WEBP form type.
const WEBP = join(ascii("RIFF"), bytes(0x24, 0x00, 0x00, 0x00), ascii("WEBP"));

describe("detectImageFormat", () => {
  it("recognises each format the bucket allows", () => {
    assert.deepEqual(detectImageFormat(PNG), {
      mime: "image/png",
      extension: "png",
    });
    assert.deepEqual(detectImageFormat(JPEG), {
      mime: "image/jpeg",
      extension: "jpg",
    });
    assert.deepEqual(detectImageFormat(GIF87), {
      mime: "image/gif",
      extension: "gif",
    });
    assert.deepEqual(detectImageFormat(GIF89), {
      mime: "image/gif",
      extension: "gif",
    });
    assert.deepEqual(detectImageFormat(WEBP), {
      mime: "image/webp",
      extension: "webp",
    });
  });

  it("still recognises a header followed by the rest of a real file", () => {
    const body = new Uint8Array(4096).fill(0x42);
    assert.equal(detectImageFormat(join(PNG, body))?.mime, "image/png");
    assert.equal(detectImageFormat(join(WEBP, body))?.mime, "image/webp");
  });

  it("only ever reports the four allowed formats", () => {
    const detected = [PNG, JPEG, GIF87, GIF89, WEBP].map((b) =>
      detectImageFormat(b),
    );

    for (const format of detected) {
      assert.ok(format);
      assert.ok(["image/png", "image/jpeg", "image/gif", "image/webp"].includes(format.mime));
      // The four extensions the storage INSERT policy's regex accepts. A fifth here
      // would be written into object keys that Storage then refuses.
      assert.ok(["png", "jpg", "webp", "gif"].includes(format.extension));
    }
  });

  it("rejects content that is not an image at all", () => {
    for (const [label, value] of [
      ["html", ascii("<!doctype html><script>alert(1)</script>")],
      ["pdf", ascii("%PDF-1.7")],
      ["zip", bytes(0x50, 0x4b, 0x03, 0x04)],
      ["elf", bytes(0x7f, 0x45, 0x4c, 0x46)],
      ["plain text", ascii("just some words in a file")],
      ["nul bytes", new Uint8Array(64)],
    ] as const) {
      assert.equal(detectImageFormat(value), null, `accepted ${label}`);
    }
  });

  it("rejects SVG, which is markup and is deliberately unsupported", () => {
    assert.equal(detectImageFormat(ascii('<svg xmlns="http://www.w3.org/2000/svg">')), null);
    assert.equal(detectImageFormat(ascii('<?xml version="1.0"?><svg>')), null);
  });

  it("rejects other RIFF containers, so RIFF alone is not enough", () => {
    // WAV and AVI share the outer container with WebP and differ only in the form
    // type at offset 8 — the reason that second part is matched.
    const wav = join(ascii("RIFF"), bytes(0x24, 0, 0, 0), ascii("WAVE"));
    const avi = join(ascii("RIFF"), bytes(0x24, 0, 0, 0), ascii("AVI "));

    assert.equal(detectImageFormat(wav), null);
    assert.equal(detectImageFormat(avi), null);
  });

  it("rejects a truncated or empty header", () => {
    assert.equal(detectImageFormat(new Uint8Array()), null);
    assert.equal(detectImageFormat(PNG.slice(0, 7)), null);
    // A correct 8-byte signature is no longer enough on its own.
    assert.equal(detectImageFormat(PNG_SIGNATURE), null);
    assert.equal(detectImageFormat(PNG.slice(0, 15)), null);
    assert.equal(detectImageFormat(ascii("GIF8")), null);
    // "RIFF" with nothing where the form type belongs.
    assert.equal(detectImageFormat(ascii("RIFF")), null);
  });

  it("matches bytes exactly, not case-insensitively or loosely", () => {
    assert.equal(detectImageFormat(ascii("gif89a")), null);
    assert.equal(detectImageFormat(ascii("riff0000webp")), null);

    const flipped = Uint8Array.from(PNG);
    flipped[3] = 0x00;
    assert.equal(detectImageFormat(flipped), null);

    const wrongChunk = Uint8Array.from(PNG);
    wrongChunk[12] = "j".charCodeAt(0); // IHDR -> jHDR
    assert.equal(detectImageFormat(wrongChunk), null);
  });

  it("needs no more than SIGNATURE_BYTES to decide", () => {
    // If a longer signature is ever added without the read growing, this catches it.
    assert.equal(SIGNATURE_BYTES, 16);

    for (const value of [PNG, JPEG, GIF87, GIF89, WEBP]) {
      const header = value.slice(0, SIGNATURE_BYTES);
      assert.ok(detectImageFormat(header), "a header was not enough to decide");
    }
  });
});

/**
 * The point of the change: the decision no longer involves the uploader's word for
 * what the file is. `detectImageFormat` takes no MIME parameter at all, so these
 * cases go through the same slice-the-header path `addNoteImage` uses, with the
 * declared type set to something flattering and irrelevant.
 */
describe("a spoofed Content-Type", () => {
  async function headerOf(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  }

  it("does not get non-image bytes accepted", async () => {
    const html = '<!doctype html><script>alert(document.cookie)</script>';

    for (const declared of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]) {
      const file = new File([html], "totally-an-image.png", { type: declared });
      assert.equal(
        detectImageFormat(await headerOf(file)),
        null,
        `bytes were accepted because the client claimed ${declared}`,
      );
    }
  });

  it("does not get an SVG accepted as a raster image", async () => {
    const file = new File(['<svg onload="alert(1)"/>'], "x.png", {
      type: "image/png",
    });

    assert.equal(detectImageFormat(await headerOf(file)), null);
  });

  it("cannot change what a real image is reported as", async () => {
    // Genuine PNG bytes, declared as a GIF. The extension and the recorded and
    // served type all come from the detection, so they follow the bytes.
    const file = new File([PNG], "mislabelled.gif", { type: "image/gif" });

    assert.deepEqual(await headerOf(file).then(detectImageFormat), {
      mime: "image/png",
      extension: "png",
    });
  });

  it("cannot get a real image past the format check by declaring junk", async () => {
    const file = new File([GIF89], "x.bin", {
      type: "application/octet-stream",
    });

    assert.equal((await headerOf(file).then(detectImageFormat))?.extension, "gif");
  });
});

/**
 * The honest limit, asserted rather than only described: a magic number identifies
 * the container, not the whole file. Bytes appended after a valid header still pass,
 * so this is not a guarantee that the payload is a well-formed or harmless image.
 * What contains it is elsewhere — a private bucket, signed URLs minted from the
 * owner's session, and a served Content-Type that now comes from these bytes.
 *
 * This is characterisation, not approval: it records what the check does today so the
 * limit is visible. If a later change starts rejecting trailing junk, invert this
 * assertion deliberately rather than reading its failure as a regression. Note that
 * rejecting it is not free — real JPEGs routinely carry padding after their end
 * marker, so a naive trailing-bytes rule would refuse genuine photos.
 */
describe("what a signature check does not prove", () => {
  it("accepts a polyglot that begins with a real image header", () => {
    const polyglot = join(PNG, ascii("<script>alert(1)</script>"));

    assert.equal(detectImageFormat(polyglot)?.mime, "image/png");
  });
});
