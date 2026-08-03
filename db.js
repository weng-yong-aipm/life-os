/* Shared Supabase client bootstrap. Every module's repo files import
 * getClient()/cloudEnabled from here instead of creating their own client. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { demoMode } from './demo.js';

export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
export async function getClient() {
  /* Demo mode never gets a client. This is the whole safety argument: real
   * rows cannot leak into a shared demo link because no client exists to
   * fetch them, and writes throw on the null client for free. */
  if (demoMode) return null;
  if (!cloudEnabled) return null;
  if (sb) return sb;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return sb;
}
