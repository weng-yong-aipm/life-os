-- W4: task-id / dedup foundation.
-- Additive + idempotent. Adds (source, source_key, synced_at) + a partial unique
-- index so external imports upsert on (user_id, source, source_key).
do $$
declare t text;
begin
  foreach t in array array[
    'receipts','work_hours','expenses','meals',
    'workouts','learning_sessions','career_goals','feed_items'
  ]
  loop
    execute format('alter table public.%I add column if not exists source text not null default ''manual''', t);
    execute format('alter table public.%I add column if not exists source_key text', t);
    execute format('alter table public.%I add column if not exists synced_at timestamptz', t);
    execute format(
      'create unique index if not exists %I on public.%I (user_id, source, source_key) where source_key is not null',
      t || '_src_uk', t
    );
  end loop;
end $$;
