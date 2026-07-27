-- ============ Goals & Certs (learning-os slice 2) ============

create table if not exists public.career_goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null,
  category     text not null default 'skill',   -- role | income | cert | course | skill
  status       text not null default 'planned', -- planned | active | done
  progress     int  not null default 0,         -- 0..100
  target_date  date,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists career_goals_user_id_idx on public.career_goals (user_id);

alter table public.career_goals enable row level security;

drop policy if exists "own_select" on public.career_goals;
drop policy if exists "own_insert" on public.career_goals;
drop policy if exists "own_update" on public.career_goals;
drop policy if exists "own_delete" on public.career_goals;
create policy "own_select" on public.career_goals for select using (auth.uid() = user_id);
create policy "own_insert" on public.career_goals for insert with check (auth.uid() = user_id);
create policy "own_update" on public.career_goals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.career_goals for delete using (auth.uid() = user_id);
