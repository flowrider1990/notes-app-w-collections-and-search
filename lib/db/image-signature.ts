/**
 * What an uploaded attachment actually is, decided from its bytes.
 *
 * `addNoteImage` used to ask `file.type` — the `Content-Type` the client attached to
 * its own multipart part — and derive the stored extension from the answer. That is
 * a claim, not a fact: an attacker calling the Server Action directly could store
 * arbitrary bytes as `image/png`, and the extension in the object key came from the
 * same untrusted string. The bucket's `allowed_mime_types` did not help, because it
 * checks the declared type too.
 *
 * So the header decides instead, and the extension and the recorded and served MIME
 * type all come from what was detected rather than what was claimed.
 *
 * Four formats, matching the bucket's `allowed_mime_types` and the extensions the
 * storage INSERT policy accepts — see docs/schema.sql section 7. **This table is the
 * source of truth for both**, so adding a format means adding it here, to the
 * bucket, and to that policy's regex. SVG is deliberately absent: it is XML, it can
 * carry script, and it has no magic number worth the name.
 *
 * Deliberately free of `server-only` and of any import, so the rule can be tested
 * against real byte arrays without standing up a Supabase client.
 */

/** A byte sequence that must appear at a fixed offset. */
type SignaturePart = { offset: number; bytes: readonly number[] };

type Signature = {
  mime: string;
  extension: string;
  /** All parts must match for the format to be recognised. */
  parts: readonly SignaturePart[];
};

/** ASCII to bytes, so the table can spell the printable markers out. */
function ascii(text: string): readonly number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

const SIGNATURES: readonly Signature[] = [
  {
    // The 8-byte PNG signature, then the first chunk's type. The trailing CR LF SUB
    // LF exists to catch mangling by anything that "helpfully" rewrites line
    // endings, so it is worth matching in full rather than stopping at "PNG"; and
    // the spec requires IHDR to be the first chunk, so the four bytes after its
    // length are fixed too. Matching them makes this the longest signature here,
    // which is what drives `SIGNATURE_BYTES` to 16 — the bytes at offset 8 are that
    // length field and are deliberately not matched.
    mime: "image/png",
    extension: "png",
    parts: [
      { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
      { offset: 12, bytes: ascii("IHDR") },
    ],
  },
  {
    // SOI, then the first marker's own 0xFF. JPEG has no longer fixed prefix — what
    // follows varies by JFIF/Exif/raw — so three bytes is the whole signature.
    mime: "image/jpeg",
    extension: "jpg",
    parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  },
  {
    mime: "image/gif",
    extension: "gif",
    parts: [{ offset: 0, bytes: ascii("GIF87a") }],
  },
  {
    mime: "image/gif",
    extension: "gif",
    parts: [{ offset: 0, bytes: ascii("GIF89a") }],
  },
  {
    // WebP is a RIFF container: "RIFF", a four-byte little-endian length that is not
    // checked, then the "WEBP" form type. Both markers are required — "RIFF" alone
    // is also WAV and AVI.
    mime: "image/webp",
    extension: "webp",
    parts: [
      { offset: 0, bytes: ascii("RIFF") },
      { offset: 8, bytes: ascii("WEBP") },
    ],
  },
];

/**
 * How many leading bytes `detectImageFormat` can need.
 *
 * Derived from the table rather than written down, so a longer signature cannot be
 * added without the read growing to match it.
 */
export const SIGNATURE_BYTES = SIGNATURES.reduce(
  (longest, signature) =>
    signature.parts.reduce(
      (inner, part) => Math.max(inner, part.offset + part.bytes.length),
      longest,
    ),
  0,
);

export type ImageFormat = {
  /** The type to record and to serve the object as. */
  mime: string;
  /** The extension for the object key. */
  extension: string;
};

function matchesAt(bytes: Uint8Array, part: SignaturePart): boolean {
  if (bytes.length < part.offset + part.bytes.length) return false;

  return part.bytes.every((byte, index) => bytes[part.offset + index] === byte);
}

/**
 * The format `bytes` begins with, or null if it is none of the four.
 *
 * Takes a header rather than a whole file — `SIGNATURE_BYTES` is enough — so nothing
 * here holds an upload. That is a copy avoided rather than buffering avoided: by the
 * time a Server Action runs, Next has already parsed the whole multipart body. A
 * short or empty array simply matches nothing.
 *
 * This identifies the *container*, which is the honest limit of a magic-number
 * check: it says the file begins as a PNG, not that the rest of it is a valid or
 * harmless PNG. Bytes appended after a real image header still pass.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  const found = SIGNATURES.find((signature) =>
    signature.parts.every((part) => matchesAt(bytes, part)),
  );

  return found ? { mime: found.mime, extension: found.extension } : null;
}
