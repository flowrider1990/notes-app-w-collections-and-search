-- Recent search queries, so a search can be re-run without retyping it.
--
-- Follows the same conventions as the other user-owned tables: uuid primary key,
-- `user_id` defaulting to auth.uid() so inserts never pass it, timestamptz, and
-- RLS enabled with owner-scoped policies per command.
--
-- `unique (user_id, query)` makes repeating a search bump the existing row rather
-- than pile up duplicates. That is an upsert, which means this table needs an
-- UPDATE policy as well as INSERT -- without it the conflict path is denied and
-- the write silently does nothing, the usual RLS failure mode.

create table if not exists public.search_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  query        text not null,
  searched_at  timestamptz not null default now(),
  unique (user_id, query)
);

-- Covers the only read: this user's history, most recent first.
create index if not exists search_history_user_searched_idx
  on public.search_history (user_id, searched_at desc);

alter table public.search_history enable row level security;

drop policy if exists search_history_select on public.search_history;
create policy search_history_select on public.search_history
  for select using (user_id = auth.uid());

drop policy if exists search_history_insert on public.search_history;
create policy search_history_insert on public.search_history
  for insert with check (user_id = auth.uid());

-- Required by the upsert, not decoration.
drop policy if exists search_history_update on public.search_history;
create policy search_history_update on public.search_history
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists search_history_delete on public.search_history;
create policy search_history_delete on public.search_history
  for delete using (user_id = auth.uid());
