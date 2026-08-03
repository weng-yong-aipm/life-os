-- ============ Phone capture bridge (Desk & Shelf, Phase 4) ============
-- The Shelf's only job here is to accept a URL typed on a phone. The Desk
-- drains it outbound with the service-role key and stays bound to 127.0.0.1.
--
-- Deliberately NO select/update/delete policy for authenticated users: the
-- page can insert and can never read back. That is the whole security
-- argument for exposing a queue on the public plane — a stolen anon session
-- can add junk to the queue, and cannot learn a single thing from it.

create table if not exists public.capture_queue (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url          text not null,
  note         text,
  created_at   timestamptz not null default now(),
  drained_at   timestamptz
);

create index if not exists capture_queue_undrained_idx
  on public.capture_queue (user_id, created_at)
  where drained_at is null;

alter table public.capture_queue enable row level security;

drop policy if exists "own_insert" on public.capture_queue;
create policy "own_insert" on public.capture_queue
  for insert with check (auth.uid() = user_id);
