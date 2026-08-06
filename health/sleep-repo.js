import { getClient } from '../db.js';
import { demoMode } from '../demo.js';
import { localDateStr } from '../shared/local-date.js';

const toRow = (r) => ({
  id: r.id,
  sleptOn: r.slept_on,
  bedAt: r.bed_at,
  wakeAt: r.wake_at,
  durationMin: r.duration_min,
  quality: r.quality,
  note: r.note,
  source: r.source,
});

export const SleepRepo = {
  /* UPSERT, not insert: the table enforces one row per night
   * (unique on user_id, slept_on). A plain insert would throw a duplicate-key
   * error the second time you correct a mistyped wake time — re-saving the same
   * night has to mean "fix it", not "fail". */
  async save({ sleptOn, bedAt, wakeAt, durationMin, quality, note }) {
    const c = await getClient();
    if (!c) throw new Error('Sleep needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c.from('sleep').upsert({
      user_id: user.id,
      slept_on: sleptOn || localDateStr(),
      bed_at: bedAt || null,
      wake_at: wakeAt || null,
      duration_min: durationMin ?? null,
      quality: quality ?? null,
      note: note || null,
      source: 'manual',
    }, { onConflict: 'user_id,slept_on' }).select().single();
    if (error) throw error;
    return toRow(data);
  },

  async listRecent(limit = 7) {
    if (demoMode) return [];
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c.from('sleep')
      .select('*').order('slept_on', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(toRow);
  },
};
