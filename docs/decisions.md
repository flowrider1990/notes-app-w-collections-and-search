# Decisions

## Persistence

**Date:**
**Decision:** Supabase (hosted Postgres), accessed from the browser via `@supabase/supabase-js`
with `@supabase/ssr` for cookie-based session handling.

### Options considered

**Browser storage only (`localStorage` / IndexedDB).** No backend, no keys, no network. Fastest to
build and the natural reading of "single-user, no-backend browser app." Rejected because a shared
link would only ever resolve in the same browser on the same machine, and because the project
requires four related tables — `notes`, `collections`, `tags`, `note_tags` — with real foreign keys
and a many-to-many join. Modelling relational data in a flat key-value store means hand-rolling
referential integrity in application code, which is where the bugs live.

**Supabase (chosen).** Gives real foreign keys and cascade behaviour, so deleting a tag cannot orphan
a join row. Postgres full-text search makes the optional search task a generated column and a GIN
index rather than a hand-written matcher. Row Level Security enforces single-user isolation at the
database rather than in the client. Links resolve on any device.

**Costs accepted.** Environment variables and a network dependency, so the app does not work offline.
RLS has to be configured deliberately — a table with RLS enabled and no matching policy returns an
empty array with no error, which presents as an empty database rather than a failure. Saving a note
is a network round trip rather than a synchronous local write.

### Consequences

- All access goes through one centralised helper module in `lib/db/`, so the storage mechanism stays
  swappable and error handling lives in one place.
- `docs/schema.sql` is the current-state reference for the whole schema. Changes go out as CLI
  migrations in `supabase/migrations/` (`npx supabase db push --linked`) and are mirrored back into
  that file; the dashboard SQL editor is the fallback when the CLI is unavailable.
- Only the publishable key is exposed to the client. Anything requiring the secret or service-role key
  indicates a policy bug, not a missing key.

### Amendments

- **Saving is explicit, not autosaved.** This entry originally assumed a debounced autosave. The
  editor ships a Save button instead: a debounced write needs the same stale-response guarding the
  search box carries, and it turns "did that save?" into something the user has to infer. The button
  answers it, and `Unsaved changes` / `Saved` says so in words.
- **Images are the one thing not in Postgres.** Attachments live in a private Supabase Storage bucket
  with rows in `note_images` recording which note owns each file. Image bytes in a column would bloat
  every read of that row and bypass the CDN. See section 7 of `docs/schema.sql`.

---

## Route naming

**Decision:** `/notes/[id]`.

The original sketch showed `/docs/[id]`, but the required table is `notes`. Routes, table names, and
helper module functions now use one word throughout rather than translating between two.
