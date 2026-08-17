import { getClient } from '../db.js';
import { localDateStr } from '../shared/local-date.js';
import { functionErrorText } from '../health/meals-repo.js';
import { parseResult, toInserts } from './parse-log.js';

/* The data half of the quick log: ask the function what a sentence means, then
 * write the rows the tested parser approved.
 *
 * Two properties matter more than anything else here, because both have already
 * cost this project real data:
 *
 * 1. A failure must say WHY on the phone. functionErrorText is reused rather
 *    than reimplemented — supabase-js flattens every non-2xx into one sentence
 *    and hides the reason in an undrained Response, which is what made the meal
 *    photo look like "manual entry is the design" for three months.
 * 2. A partial save must report itself as partial. Four tables means four
 *    inserts, and reporting "saved" when three succeeded is the exact green-over-
 *    nothing shape the rest of this codebase keeps being audited for.
 */
export const LogRepo = {
  /* Text in, the parser's verdict out. Nothing is written here — the caller
   * shows this to the user first, because a model that misread the sentence
   * should cost a glance, not a wrong row filed under today. */
  async interpret(text) {
    const c = await getClient();
    if (!c) throw new Error('Quick log needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');

    const today = localDateStr();
    const { data, error } = await c.functions.invoke('parse-log', { body: { text, today } });
    if (error) throw new Error(await functionErrorText(error));

    const parsed = parseResult(data?.raw ?? '', today);
    if (parsed.error) throw new Error(`could not read the reply — ${parsed.error}`);
    return parsed;
  },

  /* Writes what interpret() returned. Returns per-table counts and per-table
   * failures; the caller renders both. */
  async save(rows) {
    const c = await getClient();
    if (!c) throw new Error('Quick log needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');

    const inserts = toInserts(rows, user.id);
    const saved = {};
    const failed = [];

    for (const [table, payload] of Object.entries(inserts)) {
      if (!payload.length) continue;
      /* sleep is unique on (user_id, slept_on) — logging a second sentence about
       * the same night has to mean "correct it", not throw a duplicate key and
       * lose the meal that was in the same breath. */
      const q = table === 'sleep'
        ? c.from('sleep').upsert(payload, { onConflict: 'user_id,slept_on' })
        : c.from(table).insert(payload);
      const { error } = await q;
      if (error) failed.push({ table, count: payload.length, message: error.message || String(error) });
      else saved[table] = payload.length;
    }
    return { saved, failed };
  },
};
