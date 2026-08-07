-- Public bucket for CC-licensed exercise demo images (training module, phase
-- 3a). Unlike receipts/meals, this is not personal data — it's a mirror of
-- licence-clean wger.de images, filtered to CC0/CC-BY-4/CC-BY-SA-3 by
-- tools/mirror-exercise-images.mjs — so the bucket is public and there is no
-- per-user folder scoping. Only that script (service role, bypassing RLS)
-- writes to it; no insert/update/delete policy is granted to anon/authenticated
-- so the public grant below is read-only. No new public.* table is added here,
-- so no aal2 array entry is needed (same as the receipts/meals buckets, which
-- also aren't in that array — the aal2 gate covers public.* tables, not
-- storage buckets). Attribution metadata lives in health/data/exercise-media.json.
insert into storage.buckets (id, name, public) values ('exercise-media', 'exercise-media', true)
on conflict (id) do nothing;

drop policy if exists "public_exercise_media_select" on storage.objects;
create policy "public_exercise_media_select" on storage.objects
  for select using (bucket_id = 'exercise-media');
