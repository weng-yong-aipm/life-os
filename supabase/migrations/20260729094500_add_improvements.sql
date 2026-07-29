-- ============ Self-improvement engine — improvements inbox (C-series) ============
-- One reviewable inbox for every improvement suggestion (update radar, Coach scan,
-- or future LLM proposals). Nothing self-applies: rows go proposed → approved →
-- applied, or dismissed. `source_key` makes re-scans idempotent (null = always-new).

create table if not exists public.improvements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source      text not null default 'coach',           -- coach | radar | manual | llm
  source_key  text,                                     -- dedup key; null = never dedups
  kind        text not null default 'module-enhance',   -- module-enhance | tool-update | env-change
  target      text,                                     -- 'learning' | 'feed' | 'mcp:codegraph' | ...
  title       text not null,
  detail      text,
  evidence    jsonb,
  status      text not null default 'proposed',         -- proposed | approved | applied | dismissed
  created_at  timestamptz not null default now(),
  applied_at  timestamptz,
  unique (user_id, source, source_key)
);

create index if not exists improvements_user_status_idx on public.improvements (user_id, status);

alter table public.improvements enable row level security;

drop policy if exists "own_select" on public.improvements;
drop policy if exists "own_insert" on public.improvements;
drop policy if exists "own_update" on public.improvements;
drop policy if exists "own_delete" on public.improvements;
create policy "own_select" on public.improvements for select using (auth.uid() = user_id);
create policy "own_insert" on public.improvements for insert with check (auth.uid() = user_id);
create policy "own_update" on public.improvements for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.improvements for delete using (auth.uid() = user_id);
