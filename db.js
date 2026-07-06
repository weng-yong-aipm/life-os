/* Shared Supabase client bootstrap. Every module's repo files import
 * getClient()/cloudEnabled from here instead of creating their own client. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
export async function getClient() {
  if (!cloudEnabled) return null;
  if (sb) return sb;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return sb;
}
