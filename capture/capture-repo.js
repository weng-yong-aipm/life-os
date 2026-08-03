import { getClient, cloudEnabled } from '../db.js';

/* Insert-only by design. There is no list()/get() here and no select policy
 * on capture_queue — the Desk drains it with the service-role key. Adding a
 * read path to this file would quietly undo the reason the queue is allowed
 * to live on the public plane at all. */
export const CaptureRepo = {
  cloudEnabled,

  async add({ url, note }) {
    const c = await getClient();
    if (!c) throw new Error('Capture needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { error } = await c
      .from('capture_queue')
      .insert({ user_id: user.id, url, note: note || null });
    if (error) throw error;
    return true;
  },
};
