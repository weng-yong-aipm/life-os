import { getClient } from '../db.js';

/* Where the 13-week plan's tick state lives.
 *
 * Two stores on purpose. localStorage keeps the module usable with no account
 * at all — that was its original point and must not regress. Supabase is what
 * makes a tick on the laptop show up on the phone; without it the checklist is
 * per-device, which is the opposite of what a plan you carry around should do.
 *
 * Read prefers the cloud when signed in and falls back to local. Write goes to
 * BOTH, so a signed-out session still records progress locally and a later
 * signed-in save carries it up. Every cloud call is wrapped: a network blip or
 * a missing column must never lose a tick the user just made. */

const KEY = 'lifeos.plan.done';

function readLocal() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function writeLocal(done) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    /* private browsing — the checklist still works for this session */
  }
}

export const PlanRepo = {
  hasLocal() {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  },

  async load() {
    const local = readLocal();
    try {
      const c = await getClient();
      if (!c) return local;
      const { data: { user } } = await c.auth.getUser();
      if (!user) return local;
      const { data, error } = await c.from('user_settings').select('plan_done').maybeSingle();
      if (error || !data?.plan_done) return local;
      const cloud = new Set(data.plan_done);
      /* Union, not replace: a tick made offline on this device would otherwise
       * be silently dropped the moment the cloud copy loads. Unticking is rare
       * and recoverable; losing a completed task is not. */
      for (const id of local) cloud.add(id);
      writeLocal(cloud);
      return cloud;
    } catch {
      return local;
    }
  },

  async save(done) {
    writeLocal(done);
    try {
      const c = await getClient();
      if (!c) return;
      const { data: { user } } = await c.auth.getUser();
      if (!user) return;
      await c.from('user_settings').upsert(
        { user_id: user.id, plan_done: [...done] },
        { onConflict: 'user_id' },
      );
    } catch {
      /* Local write already succeeded — a failed sync must not surface as a
       * lost tick. It will be carried up by the union on the next load. */
    }
  },
};
