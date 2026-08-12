import { createClient } from "@/lib/supabase/server";

export type Note = {
  id: string;
  collection_id: string | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

/**
 * Every note the signed-in user owns, newest first.
 *
 * RLS scopes this to `user_id = auth.uid()`, so "every row" means every row
 * visible to the caller — there is no way to read another user's notes with the
 * publishable key, and no filter is needed here.
 *
 * supabase-js reports failures in `error` instead of throwing. That check is
 * centralised here so callers get either notes or an exception, never a silent
 * empty list masking a real error.
 */
export async function getNotes(): Promise<Note[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .select("id, collection_id, title, body, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load notes: ${error.message}`);
  }

  return data ?? [];
}
