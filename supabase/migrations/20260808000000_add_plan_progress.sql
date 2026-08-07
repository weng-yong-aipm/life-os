-- 13-week plan tick state, so it follows you between phone and laptop.
--
-- A column on user_settings rather than a table of its own: this is one small
-- set of task ids for a single user, and user_settings already carries the RLS
-- policies, the aal2 gate and a working repo pattern. A dedicated table would
-- mean four more policies and another aal2 array entry to keep in sync, for a
-- value that is never queried by anything but "give me the whole set".
--
-- localStorage stays as the offline/signed-out fallback in plan-ui.js — the
-- module's original point was that it works with no account at all, and that
-- should not regress just because it can now sync.

alter table public.user_settings
  add column if not exists plan_done text[] not null default '{}';
