-- Run this once in your NEW life-os Supabase project:
--   Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Creates every Finance-module table with Row Level Security so each
-- account can only see and edit its own rows, plus a private Storage
-- bucket for receipt photos.

create table if not exists public.receipts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  image_path    text,
  merchant      text,
  purchased_at  date,
  raw_json      jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.receipt_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.receipts(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  price           numeric,
  category        text,
  calories        numeric,
  protein_g       numeric,
  carbs_g         numeric,
  fat_g           numeric,
  edited_by_user  boolean not null default false
);

create or replace function public.check_receipt_item_ownership()
returns trigger as $$
begin
  if not exists (
    select 1 from public.receipts
    where id = new.receipt_id and user_id = new.user_id
  ) then
    raise exception 'receipt_id % does not belong to user_id %', new.receipt_id, new.user_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists check_receipt_item_ownership_trigger on public.receipt_items;
create trigger check_receipt_item_ownership_trigger
  before insert or update on public.receipt_items
  for each row execute function public.check_receipt_item_ownership();

create table if not exists public.pay_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  base_hourly_rate    numeric not null default 0,
  weekend_multiplier  numeric not null default 1.5,
  holiday_multiplier  numeric not null default 2.0,
  currency            text not null default 'MYR'
);

create table if not exists public.work_hours (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  work_date      date not null,
  hours          numeric not null,
  day_type       text not null,
  computed_pay   numeric not null,
  created_at     timestamptz not null default now()
);

create index if not exists receipts_user_id_idx on public.receipts (user_id);
create index if not exists receipt_items_receipt_id_idx on public.receipt_items (receipt_id);
create index if not exists receipt_items_user_id_idx on public.receipt_items (user_id);
create index if not exists work_hours_user_id_idx on public.work_hours (user_id);

alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.pay_settings enable row level security;
alter table public.work_hours enable row level security;

drop policy if exists "own_select" on public.receipts;
drop policy if exists "own_insert" on public.receipts;
drop policy if exists "own_update" on public.receipts;
drop policy if exists "own_delete" on public.receipts;
create policy "own_select" on public.receipts for select using (auth.uid() = user_id);
create policy "own_insert" on public.receipts for insert with check (auth.uid() = user_id);
create policy "own_update" on public.receipts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.receipts for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.receipt_items;
drop policy if exists "own_insert" on public.receipt_items;
drop policy if exists "own_update" on public.receipt_items;
drop policy if exists "own_delete" on public.receipt_items;
create policy "own_select" on public.receipt_items for select using (auth.uid() = user_id);
create policy "own_insert" on public.receipt_items for insert with check (auth.uid() = user_id);
create policy "own_update" on public.receipt_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.receipt_items for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.pay_settings;
drop policy if exists "own_insert" on public.pay_settings;
drop policy if exists "own_update" on public.pay_settings;
create policy "own_select" on public.pay_settings for select using (auth.uid() = user_id);
create policy "own_insert" on public.pay_settings for insert with check (auth.uid() = user_id);
create policy "own_update" on public.pay_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_select" on public.work_hours;
drop policy if exists "own_insert" on public.work_hours;
drop policy if exists "own_update" on public.work_hours;
drop policy if exists "own_delete" on public.work_hours;
create policy "own_select" on public.work_hours for select using (auth.uid() = user_id);
create policy "own_insert" on public.work_hours for insert with check (auth.uid() = user_id);
create policy "own_update" on public.work_hours for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.work_hours for delete using (auth.uid() = user_id);

-- Private bucket for receipt photos. Objects are stored as "<user_id>/<file>",
-- and the policies below only allow a user to touch objects under their own folder.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "own_receipt_photos_select" on storage.objects;
drop policy if exists "own_receipt_photos_insert" on storage.objects;
drop policy if exists "own_receipt_photos_update" on storage.objects;
drop policy if exists "own_receipt_photos_delete" on storage.objects;
create policy "own_receipt_photos_select" on storage.objects
  for select using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_receipt_photos_insert" on storage.objects
  for insert with check (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_receipt_photos_update" on storage.objects
  for update using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_receipt_photos_delete" on storage.objects
  for delete using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============ Trackers: expenses / meals / workouts ============

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spent_at    date not null,
  amount      numeric not null,
  category    text not null default 'other',
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_at    date not null,
  name        text not null,
  source      text not null default 'manual',
  image_path  text,
  calories    numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  created_at  timestamptz not null default now()
);

create table if not exists public.workouts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  done_at         date not null,
  exercise        text not null,
  category        text,
  sets            int, reps int, weight_kg numeric,
  duration_min    numeric,
  calories_burned numeric,
  created_at      timestamptz not null default now()
);

create index if not exists expenses_user_id_idx on public.expenses (user_id);
create index if not exists expenses_spent_at_idx on public.expenses (spent_at);
create index if not exists meals_user_id_idx on public.meals (user_id);
create index if not exists meals_eaten_at_idx on public.meals (eaten_at);
create index if not exists workouts_user_id_idx on public.workouts (user_id);
create index if not exists workouts_done_at_idx on public.workouts (done_at);

alter table public.expenses enable row level security;
alter table public.meals enable row level security;
alter table public.workouts enable row level security;

drop policy if exists "own_select" on public.expenses;
drop policy if exists "own_insert" on public.expenses;
drop policy if exists "own_update" on public.expenses;
drop policy if exists "own_delete" on public.expenses;
create policy "own_select" on public.expenses for select using (auth.uid() = user_id);
create policy "own_insert" on public.expenses for insert with check (auth.uid() = user_id);
create policy "own_update" on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.expenses for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.meals;
drop policy if exists "own_insert" on public.meals;
drop policy if exists "own_update" on public.meals;
drop policy if exists "own_delete" on public.meals;
create policy "own_select" on public.meals for select using (auth.uid() = user_id);
create policy "own_insert" on public.meals for insert with check (auth.uid() = user_id);
create policy "own_update" on public.meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.meals for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.workouts;
drop policy if exists "own_insert" on public.workouts;
drop policy if exists "own_update" on public.workouts;
drop policy if exists "own_delete" on public.workouts;
create policy "own_select" on public.workouts for select using (auth.uid() = user_id);
create policy "own_insert" on public.workouts for insert with check (auth.uid() = user_id);
create policy "own_update" on public.workouts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.workouts for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('meals', 'meals', false)
on conflict (id) do nothing;

drop policy if exists "own_meal_photos_select" on storage.objects;
drop policy if exists "own_meal_photos_insert" on storage.objects;
drop policy if exists "own_meal_photos_update" on storage.objects;
drop policy if exists "own_meal_photos_delete" on storage.objects;
create policy "own_meal_photos_select" on storage.objects
  for select using (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_meal_photos_insert" on storage.objects
  for insert with check (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_meal_photos_update" on storage.objects
  for update using (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_meal_photos_delete" on storage.objects
  for delete using (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============ Learning Log (learning-os slice 1) ============

create table if not exists public.learning_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  learned_on    date not null,
  source        text not null default 'douyin',   -- douyin | instagram | other
  link          text,
  title         text not null,
  summary       text,                              -- what I learned
  project       text,                              -- which of my projects it maps to
  verdict       text not null default 'considering', -- applied | rejected | considering
  applied_note  text,                              -- what got applied, or why rejected
  tags          text[],
  created_at    timestamptz not null default now()
);

create index if not exists learning_user_id_idx on public.learning_sessions (user_id);
create index if not exists learning_learned_on_idx on public.learning_sessions (learned_on);

alter table public.learning_sessions enable row level security;

drop policy if exists "own_select" on public.learning_sessions;
drop policy if exists "own_insert" on public.learning_sessions;
drop policy if exists "own_update" on public.learning_sessions;
drop policy if exists "own_delete" on public.learning_sessions;
create policy "own_select" on public.learning_sessions for select using (auth.uid() = user_id);
create policy "own_insert" on public.learning_sessions for insert with check (auth.uid() = user_id);
create policy "own_update" on public.learning_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.learning_sessions for delete using (auth.uid() = user_id);
