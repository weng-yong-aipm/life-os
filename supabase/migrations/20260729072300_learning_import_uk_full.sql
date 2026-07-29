-- W5 fix: the partial unique index (WHERE external_id IS NOT NULL) cannot be
-- inferred by supabase-js/PostgREST column-only ON CONFLICT (raises 42P10).
-- Recreate it as a full unique index so upsert on (user_id, source, external_id)
-- works. NULL external_ids remain distinct (non-import rows never collide).
drop index if exists public.learning_sessions_import_uk;
create unique index if not exists learning_sessions_import_uk
  on public.learning_sessions (user_id, source, external_id);
