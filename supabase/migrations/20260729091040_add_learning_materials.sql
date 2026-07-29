-- W3: AI-generated study materials per learning item. One row per
-- (user, learning_session) so re-generation upserts (idempotent).
create table if not exists public.learning_materials (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  learning_session_id uuid not null references public.learning_sessions(id) on delete cascade,
  model               text,
  content             jsonb not null,      -- { guide, flashcards[], quiz[] }
  created_at          timestamptz not null default now(),
  unique (user_id, learning_session_id)
);
alter table public.learning_materials enable row level security;
drop policy if exists lm_own_select on public.learning_materials;
drop policy if exists lm_own_insert on public.learning_materials;
drop policy if exists lm_own_update on public.learning_materials;
drop policy if exists lm_own_delete on public.learning_materials;
create policy lm_own_select on public.learning_materials for select using (auth.uid() = user_id);
create policy lm_own_insert on public.learning_materials for insert with check (auth.uid() = user_id);
create policy lm_own_update on public.learning_materials for update using (auth.uid() = user_id);
create policy lm_own_delete on public.learning_materials for delete using (auth.uid() = user_id);
