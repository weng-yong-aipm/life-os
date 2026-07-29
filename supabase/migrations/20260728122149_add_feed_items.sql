-- ============ Feed → Digest (learning-os slice 3) ============
-- Auto-ingested items from the top-AI-creator follow-list (feed/sources.js).
-- The ingest script (scripts/ingest-feed.mjs) writes here via the service role;
-- the PWA reads/triages, and promotes chosen items into learning_sessions.

create table if not exists public.feed_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null,                    -- youtube | rss | bilibili | reddit | x | instagram | douyin
  source_handle text,
  source_name   text,
  external_id   text not null,                    -- dedupe key (video id / feed entry id / post id)
  url           text,
  title         text not null,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  summary       text,                             -- <=60-word LLM summary
  topics        text[],
  duration_sec  int,                              -- video length (long-form aware)
  status        text not null default 'new',      -- new | applied | considering | rejected
  promoted_learning_id uuid references public.learning_sessions(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (user_id, external_id)
);

create index if not exists feed_items_user_id_idx on public.feed_items (user_id);
create index if not exists feed_items_status_idx  on public.feed_items (user_id, status);
create index if not exists feed_items_fetched_idx on public.feed_items (user_id, fetched_at desc);

alter table public.feed_items enable row level security;

drop policy if exists "own_select" on public.feed_items;
drop policy if exists "own_insert" on public.feed_items;
drop policy if exists "own_update" on public.feed_items;
drop policy if exists "own_delete" on public.feed_items;
create policy "own_select" on public.feed_items for select using (auth.uid() = user_id);
create policy "own_insert" on public.feed_items for insert with check (auth.uid() = user_id);
create policy "own_update" on public.feed_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.feed_items for delete using (auth.uid() = user_id);
