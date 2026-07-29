-- W4 correction: the blanket source/source_key added by the previous migration
-- collided with existing domain columns (meals.source=logging method,
-- learning_sessions.source=capture platform) and duplicated feed_items' own
-- (user_id, external_id) dedup. Revert the blanket columns; scope dedup to
-- learning_sessions using the existing external_id pattern (reusing its source).
do $$
declare t text;
begin
  foreach t in array array[
    'receipts','work_hours','expenses','meals',
    'workouts','learning_sessions','career_goals','feed_items'
  ]
  loop
    execute format('drop index if exists public.%I', t || '_src_uk');
    execute format('alter table public.%I drop column if exists source_key', t);
    execute format('alter table public.%I drop column if exists synced_at', t);
  end loop;
  foreach t in array array[
    'receipts','work_hours','expenses','workouts','career_goals','feed_items'
  ]
  loop
    execute format('alter table public.%I drop column if exists source', t);
  end loop;
end $$;

alter table public.learning_sessions add column if not exists external_id text;
alter table public.learning_sessions add column if not exists synced_at timestamptz;
create unique index if not exists learning_sessions_import_uk
  on public.learning_sessions (user_id, source, external_id) where external_id is not null;
