-- Phase 1 of the unified hub: the nightly check-in loop.
-- docs/superpowers/specs/2026-10-15-unified-hub-design.md
--
-- milestones / checkins / goal_sync_status are written only by the service
-- role (goal-sync on the Mac, the nudge/checkin edge functions), so the owner
-- gets select policies and nothing else. push_subscriptions is the one table
-- the app writes: subscribing happens in the browser.

create table if not exists public.milestones (
  id          text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$'),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  due         date not null,
  status      text not null check (status in ('todo', 'doing', 'done', 'dropped')),
  next_step   text not null default '',
  updated_at  timestamptz not null default now()
);

create table if not exists public.checkins (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,
  milestone_id  text not null references public.milestones(id),
  done          boolean not null,
  answered_at   timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1024),
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.goal_sync_status (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  synced_at  timestamptz,
  ok         boolean not null default false,
  error      text
);

alter table public.milestones         enable row level security;
alter table public.checkins           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.goal_sync_status   enable row level security;

create policy "own_select" on public.milestones         for select using (auth.uid() = user_id);
create policy "own_select" on public.checkins           for select using (auth.uid() = user_id);
create policy "own_select" on public.goal_sync_status   for select using (auth.uid() = user_id);
create policy "own_select" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "own_insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "own_delete" on public.push_subscriptions for delete using (auth.uid() = user_id);

do $$
declare
  t text;
begin
  foreach t in array array['milestones', 'checkins', 'push_subscriptions', 'goal_sync_status']
  loop
    execute format('drop policy if exists "aal2_when_mfa_enrolled" on public.%I', t);
    execute format(
      'create policy "aal2_when_mfa_enrolled" on public.%I ' ||
      'as restrictive for all to authenticated ' ||
      'using (not public.requires_aal2() or (select auth.jwt()->>''aal'') = ''aal2'') ' ||
      'with check (not public.requires_aal2() or (select auth.jwt()->>''aal'') = ''aal2'')',
      t
    );
  end loop;
end $$;
