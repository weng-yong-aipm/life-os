// Deploy: supabase functions deploy checkin --no-verify-jwt
// Called by the service worker with no session; the HMAC token minted by
// `nudge` is the only credential, bound to one day and one milestone.
// Secrets: CHECKIN_SECRET, OWNER_USER_ID
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { makeDb } from '../_shared/hub-db.ts';
import { handleCheckin } from './handler.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve((req) =>
  handleCheckin(req, {
    env: { CHECKIN_SECRET: env('CHECKIN_SECRET'), OWNER_USER_ID: env('OWNER_USER_ID'), APP_ORIGIN: 'https://weng-yong-aipm.github.io' },
    db: makeDb(createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY')), env('OWNER_USER_ID')),
    now: () => new Date(),
  })
);
