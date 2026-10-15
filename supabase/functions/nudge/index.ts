// Deploy: supabase functions deploy nudge --no-verify-jwt
// Called by pg_cron (21:00 and 08:00 MYT); guarded by X-Job-Secret == JOB_SECRET.
// Secrets: JOB_SECRET, CHECKIN_SECRET, OWNER_USER_ID, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { makeDb } from '../_shared/hub-db.ts';
import { createWebPushSender } from '../_shared/push.ts';
import { handleNudge } from './handler.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');

Deno.serve((req) =>
  handleNudge(req, {
    env: {
      JOB_SECRET: env('JOB_SECRET'),
      CHECKIN_SECRET: env('CHECKIN_SECRET'),
      OWNER_USER_ID: env('OWNER_USER_ID'),
      CHECKIN_URL: `${SUPABASE_URL}/functions/v1/checkin`,
    },
    db: makeDb(createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY')), env('OWNER_USER_ID')),
    sender: createWebPushSender({ publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') }),
    now: () => new Date(),
  })
);
