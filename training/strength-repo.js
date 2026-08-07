/* Training I/O — the gym screen's only import. Pairs with the pure logic in
 * strength.js (resolveCursor / suggestSet / buildProgressionSeries), which
 * this file calls but never reimplements. See
 * docs/superpowers/specs/2026-08-06-training-module-design.md §1, §4b.
 *
 * The load-bearing rule from that doc: position is DERIVED, never stored.
 * Every function that needs "where am I" re-fetches the plan and the logged
 * sets, then hands them to resolveCursor. Nothing here keeps a cursor in a
 * module-level variable or a `current_exercise_id` column. */

import { getClient } from '../db.js';
import { localDateStr } from '../shared/local-date.js';
import {
  resolveCursor, suggestSet, buildProgressionSeries, sessionForDate, requiresSupersede,
} from './strength.js';

function toPlan(exercises) {
  return exercises.map((e) => ({
    sessionExerciseId: e.id,
    position: e.position,
    targetSets: e.target_sets,
    skippedReason: e.skipped_reason,
  }));
}

function toLogged(sets) {
  return sets.map((s) => ({ sessionExerciseId: s.session_exercise_id, setNo: s.set_no }));
}

function toSetRow(s) {
  return {
    id: s.id,
    sessionExerciseId: s.session_exercise_id,
    setNo: s.set_no,
    weightKg: s.weight_kg,
    reps: s.reps,
    rir: s.rir,
    completedAt: s.completed_at,
    source: s.source,
  };
}

/* The single best set of a history batch, for the "last time: 20 kg × 9"
 * display line — same volume-then-weight tie-break suggestSet uses
 * internally, but that comparison isn't exported, so it's repeated here in
 * miniature rather than exposing internals of strength.js for one display
 * value. */
function bestOf(sets) {
  return sets.reduce((best, s) => {
    if (!best) return s;
    const v = (s.weight_kg || 0) * (s.reps || 0);
    const bv = (best.weight_kg || 0) * (best.reps || 0);
    if (v > bv) return s;
    if (v === bv && (s.weight_kg || 0) > (best.weight_kg || 0)) return s;
    return best;
  }, null);
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function requireClient() {
  const c = await getClient();
  if (!c) throw new Error('Training needs cloud sync — enable Supabase in config.js.');
  const { data: { user } } = await c.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  return { c, user };
}

async function findTodaySession(c) {
  const { data, error } = await c.from('sessions').select('*')
    .eq('date', localDateStr())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getOrCreateTodaySession(c, userId) {
  const existing = await findTodaySession(c);
  if (existing) return existing;
  const { data, error } = await c.from('sessions')
    .insert({ user_id: userId, date: localDateStr(), status: 'active' })
    .select().single();
  if (error) throw error;
  return data;
}

async function loadPlanAndSets(c, sessionId) {
  const { data: exercises, error: e1 } = await c.from('session_exercises').select('*')
    .eq('session_id', sessionId).order('position', { ascending: true });
  if (e1) throw e1;

  const ids = (exercises || []).map((e) => e.id);
  let sets = [];
  if (ids.length) {
    const { data, error: e2 } = await c.from('sets').select('*')
      .in('session_exercise_id', ids).order('set_no', { ascending: true });
    if (e2) throw e2;
    sets = data || [];
  }
  return { exercises: exercises || [], sets };
}

/* First log of the day on a plan-less session: carry the most recent prior
 * session's exercises forward (name, position, target rep/RIR range) so
 * there is something to log against without a block-builder (phase 3c,
 * out of scope here). If there is no prior session either, this is a
 * genuine cold start — the caller gets `{ empty: true }` and today's session
 * stays plan-less until one exists. */
async function cloneForwardIfEmpty(c, session) {
  const { data: prevSession, error: e1 } = await c.from('sessions').select('id')
    .lt('date', session.date)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) throw e1;
  if (!prevSession) return [];

  const { data: prevExercises, error: e2 } = await c.from('session_exercises').select('*')
    .eq('session_id', prevSession.id).order('position', { ascending: true });
  if (e2) throw e2;
  if (!prevExercises || !prevExercises.length) return [];

  const rows = prevExercises.map((e) => ({
    session_id: session.id,
    exercise_name: e.exercise_name,
    position: e.position,
    target_sets: e.target_sets,
    target_rep_low: e.target_rep_low,
    target_rep_high: e.target_rep_high,
    target_rir: e.target_rir,
  }));
  const { data: inserted, error: e3 } = await c.from('session_exercises').insert(rows).select();
  if (e3) throw e3;
  return inserted || [];
}

/* Last time this exercise was performed, before `beforeDate` — walks recent
 * sessions newest-first and returns the first one that logged this exercise.
 * Bounded to 20 sessions back so a brand-new exercise name doesn't walk the
 * whole history. */
async function historyFor(c, exerciseName, beforeDate) {
  const { data: sessions, error: e1 } = await c.from('sessions').select('id')
    .lt('date', beforeDate)
    .order('date', { ascending: false })
    .limit(20);
  if (e1) throw e1;

  for (const s of sessions || []) {
    const { data: match, error: e2 } = await c.from('session_exercises').select('id')
      .eq('session_id', s.id).eq('exercise_name', exerciseName).limit(1).maybeSingle();
    if (e2) throw e2;
    if (!match) continue;

    const { data: rows, error: e3 } = await c.from('sets').select('*')
      .eq('session_exercise_id', match.id);
    if (e3) throw e3;
    if (rows && rows.length) return rows;
  }
  return [];
}

/* How many sets are already logged against one session_exercise — the one
 * fact requiresSupersede needs to decide whether an edit is free or must
 * preserve the row. */
async function countLoggedSets(c, sessionExerciseId) {
  const { count, error } = await c.from('sets')
    .select('id', { count: 'exact', head: true })
    .eq('session_exercise_id', sessionExerciseId);
  if (error) throw error;
  return count || 0;
}

/* Preserves `row` (and its logged sets) exactly as-is, marking it aside via
 * the existing `skipped_reason` column — resolveCursor already treats any
 * truthy skipped_reason as "skip this exercise", so this alone removes it
 * from the cursor without touching a single `sets` row. Then inserts a
 * fresh session_exercise in its place, same session/position/targets, new
 * name. Used by both swapExercise and replaceExerciseInBlock so the two
 * share one definition of "supersede". */
async function supersede(c, row, newExerciseName, note) {
  const { error: e1 } = await c.from('session_exercises')
    .update({ skipped_reason: note })
    .eq('id', row.id);
  if (e1) throw e1;

  const { error: e2 } = await c.from('session_exercises').insert({
    session_id: row.session_id,
    exercise_name: newExerciseName,
    position: row.position,
    target_sets: row.target_sets,
    target_rep_low: row.target_rep_low,
    target_rep_high: row.target_rep_high,
    target_rir: row.target_rir,
  });
  if (e2) throw e2;
}

export const StrengthRepo = {
  /* The only call the gym screen makes on mount. Resolves (creating if
   * needed) today's session, then the next unfilled set via resolveCursor.
   * Returns `{ empty: true }` when there is no plan to log against, or
   * `{ sessionComplete: true }` once every planned set is logged. */
  async getCurrentSet() {
    const { c, user } = await requireClient();
    const session = await getOrCreateTodaySession(c, user.id);
    let { exercises, sets } = await loadPlanAndSets(c, session.id);

    if (!exercises.length) {
      exercises = await cloneForwardIfEmpty(c, session);
      sets = [];
    }
    if (!exercises.length) return { empty: true };

    const cursor = resolveCursor(toPlan(exercises), toLogged(sets));
    if (cursor === 'session_complete') return { sessionComplete: true };

    const exercise = exercises.find((e) => e.id === cursor.sessionExerciseId);
    const history = await historyFor(c, exercise.exercise_name, session.date);
    const target = {
      repLow: exercise.target_rep_low,
      repHigh: exercise.target_rep_high,
      rir: exercise.target_rir,
    };
    const suggestion = suggestSet(target, history.map((s) => ({
      weightKg: s.weight_kg, reps: s.reps, rir: s.rir,
    })));
    const last = bestOf(history);

    return {
      sessionExerciseId: exercise.id,
      exerciseName: exercise.exercise_name,
      setNumber: cursor.setNumber,
      targetSets: exercise.target_sets,
      weightKg: suggestion.weightKg,
      reps: suggestion.reps,
      rir: suggestion.rir,
      source: suggestion.source,
      lastTime: last ? { weightKg: last.weight_kg, reps: last.reps } : null,
    };
  },

  /* No overrides = log the current suggestion verbatim. Re-derives the
   * current set itself rather than trusting a UI-held value, so it always
   * logs against whatever resolveCursor says is next right now. */
  async logSet(overrides = {}) {
    const { c } = await requireClient();
    const cur = await this.getCurrentSet();
    if (!cur || cur.sessionComplete || cur.empty) throw new Error('Nothing to log.');

    const { data, error } = await c.from('sets').insert({
      session_exercise_id: cur.sessionExerciseId,
      set_no: cur.setNumber,
      weight_kg: overrides.weightKg ?? cur.weightKg,
      reps: overrides.reps ?? cur.reps,
      rir: overrides.rir ?? cur.rir,
      source: 'manual',
    }).select().single();
    if (error) throw error;

    return { logged: toSetRow(data), next: await this.getCurrentSet() };
  },

  /* LIFO: deletes the most recently completed set in today's session,
   * regardless of which exercise it belongs to. A no-op (not an error) when
   * there is nothing to undo. */
  async undoLastSet() {
    const { c } = await requireClient();
    const session = await findTodaySession(c);
    if (!session) return;

    const { exercises } = await loadPlanAndSets(c, session.id);
    const ids = exercises.map((e) => e.id);
    if (!ids.length) return;

    const { data: last, error: e1 } = await c.from('sets').select('id')
      .in('session_exercise_id', ids)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e1) throw e1;
    if (!last) return;

    const { error: e2 } = await c.from('sets').delete().eq('id', last.id);
    if (e2) throw e2;
  },

  /* Read-only summary of today's plan — degrades to [] rather than throwing
   * when there is no client or no session yet, matching the quiet-empty
   * convention of other repos' list calls (sleep-repo.listRecent etc). */
  async getSessionPlan() {
    const c = await getClient();
    if (!c) return [];
    const { data: { user } } = await c.auth.getUser();
    if (!user) return [];

    const session = await findTodaySession(c);
    if (!session) return [];

    const { exercises, sets } = await loadPlanAndSets(c, session.id);
    return exercises.map((e) => ({
      sessionExerciseId: e.id,
      exerciseName: e.exercise_name,
      targetSets: e.target_sets,
      setsLogged: sets.filter((s) => s.session_exercise_id === e.id).length,
    }));
  },

  /* "Did them out of order": swaps `position` between the exercise
   * resolveCursor currently points to and the target, so the next
   * resolveCursor call (including the one inside logSet) lands on the
   * target — a real, durable edit to the plan rather than a stored cursor. */
  async jumpToExercise(sessionExerciseId) {
    const { c, user } = await requireClient();
    const session = await getOrCreateTodaySession(c, user.id);
    const { exercises, sets } = await loadPlanAndSets(c, session.id);

    const cursor = resolveCursor(toPlan(exercises), toLogged(sets));
    if (cursor !== 'session_complete' && cursor.sessionExerciseId !== sessionExerciseId) {
      const target = exercises.find((e) => e.id === sessionExerciseId);
      const atCursor = exercises.find((e) => e.id === cursor.sessionExerciseId);
      if (target && atCursor && target.position !== atCursor.position) {
        await c.from('session_exercises').update({ position: atCursor.position }).eq('id', target.id);
        await c.from('session_exercises').update({ position: target.position }).eq('id', atCursor.id);
      }
    }

    return this.getCurrentSet();
  },

  /* Marks the exercise resolveCursor currently points to as skipped, then
   * hands back whatever comes next. */
  async skipExercise(reason) {
    const { c } = await requireClient();
    const session = await findTodaySession(c);
    if (!session) return this.getCurrentSet();

    const { exercises, sets } = await loadPlanAndSets(c, session.id);
    const cursor = resolveCursor(toPlan(exercises), toLogged(sets));
    if (cursor === 'session_complete') return { sessionComplete: true };

    const { error } = await c.from('session_exercises')
      .update({ skipped_reason: reason || 'skipped' })
      .eq('id', cursor.sessionExerciseId);
    if (error) throw error;

    return this.getCurrentSet();
  },

  async finishWorkout() {
    const { c } = await requireClient();
    const session = await findTodaySession(c);
    if (!session) return;

    const { error } = await c.from('sessions').update({ status: 'complete' }).eq('id', session.id);
    if (error) throw error;
  },

  /* Progression for one exercise, across all sessions. Read-only: degrades
   * to [] rather than throwing, same convention as getSessionPlan. */
  async getProgression(exerciseName, { since } = {}) {
    const c = await getClient();
    if (!c) return [];
    const { data: { user } } = await c.auth.getUser();
    if (!user) return [];

    const { data: exRows, error: e1 } = await c.from('session_exercises')
      .select('id, session_id, sessions(date)')
      .eq('exercise_name', exerciseName);
    if (e1) throw e1;
    if (!exRows || !exRows.length) return [];

    const ids = exRows.map((e) => e.id);
    const { data: setRows, error: e2 } = await c.from('sets').select('*')
      .in('session_exercise_id', ids);
    if (e2) throw e2;

    const meta = new Map(exRows.map((e) => [e.id, { sessionId: e.session_id, date: e.sessions?.date }]));
    let points = (setRows || []).map((s) => {
      const m = meta.get(s.session_exercise_id) || {};
      return { sessionId: m.sessionId, date: m.date, weightKg: s.weight_kg, reps: s.reps };
    });
    if (since) points = points.filter((p) => p.date >= since);

    return buildProgressionSeries(points);
  },

  /* Materialises the whole block up front: a `sessions` row (with its real
   * calendar date) plus `session_exercises` for every day, across every
   * week, that sessionForDate matches to a planned session. Rest days get
   * nothing.
   *
   * This is EAGER, not lazy, and deliberately so: `sessions.date` is
   * NOT NULL, so a lazy "session template with no date yet" doesn't fit
   * this schema without inventing a second, parallel plan store. Eager
   * materialisation needs no new table — the sessions/session_exercises
   * rows this writes ARE the plan, and getCurrentSet() (3b, unchanged)
   * already finds "today" by querying `sessions` for today's date, so a
   * plan day just works the moment its row exists. Off-plan days still get
   * nothing here, so cloneForwardIfEmpty (3b's fallback) still fires for
   * them exactly as before.
   *
   * Eager materialisation used to mean editing a started block had no
   * lever besides end-and-recreate (which threw away logged history) — see
   * swapExercise/replaceExerciseInBlock/updateTargets/addExerciseToSession/
   * removeExerciseFromSession (phase 3d, below) for the fix.
   *
   * @param plan { name, goal, weeks, startDate, sessions: [{ dayOfWeek, name,
   *   exercises: [{ exerciseName, targetSets, targetRepLow, targetRepHigh, targetRir }] }] }
   */
  async createMesocycle(plan) {
    const { c, user } = await requireClient();
    const { data: meso, error: e1 } = await c.from('mesocycles').insert({
      user_id: user.id,
      name: plan.name,
      goal: plan.goal,
      weeks: plan.weeks,
      start_date: plan.startDate,
      status: 'active',
    }).select().single();
    if (e1) throw e1;

    const template = { startDate: plan.startDate, weeks: plan.weeks, sessions: plan.sessions };
    for (let offset = 0; offset < plan.weeks * 7; offset++) {
      const date = addDaysStr(plan.startDate, offset);
      const planned = sessionForDate(template, date);
      if (!planned) continue;

      const { data: session, error: e2 } = await c.from('sessions').insert({
        user_id: user.id,
        mesocycle_id: meso.id,
        week_no: planned.weekNo,
        day_no: planned.dayOfWeek,
        name: planned.name,
        date,
        status: 'planned',
      }).select().single();
      if (e2) throw e2;

      const rows = (planned.exercises || []).map((ex, i) => ({
        session_id: session.id,
        exercise_name: ex.exerciseName,
        position: i + 1,
        target_sets: ex.targetSets,
        target_rep_low: ex.targetRepLow,
        target_rep_high: ex.targetRepHigh,
        target_rir: ex.targetRir,
      }));
      if (rows.length) {
        const { error: e3 } = await c.from('session_exercises').insert(rows);
        if (e3) throw e3;
      }
    }

    return meso;
  },

  /* Read-only. Degrades to [] rather than throwing when there is no client
   * or no session, matching getSessionPlan/getProgression's convention. */
  async listMesocycles() {
    const c = await getClient();
    if (!c) return [];
    const { data: { user } } = await c.auth.getUser();
    if (!user) return [];

    const { data, error } = await c.from('mesocycles').select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /* Read-only. Degrades to null, same convention as listMesocycles. */
  async getActiveMesocycle() {
    const c = await getClient();
    if (!c) return null;
    const { data: { user } } = await c.auth.getUser();
    if (!user) return null;

    const { data, error } = await c.from('mesocycles').select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /* Marks the block ended and drops its still-`planned` sessions strictly
   * after today, so tomorrow stops finding this block's rows. Today's
   * session (and anything in the past) is never touched, planned or not —
   * that would risk deleting a session with real logged sets under it. */
  async endMesocycle(id) {
    const { c } = await requireClient();
    const { error: e1 } = await c.from('sessions').delete()
      .eq('mesocycle_id', id)
      .eq('status', 'planned')
      .gt('date', localDateStr());
    if (e1) throw e1;

    const { error: e2 } = await c.from('mesocycles').update({ status: 'ended' }).eq('id', id);
    if (e2) throw e2;
  },

  /* Block editing (phase 3d) — the gap createMesocycle's own comment flags:
   * once a block starts there was no way to change it short of
   * end-and-recreate, which throws away logged history. The rule that makes
   * these five methods safe: a session_exercise with logged sets is never
   * destructively rewritten. requiresSupersede (strength.js, pure) decides
   * per row; supersede() (above) is the shared implementation. Editing a row
   * with zero sets is a plain UPDATE/DELETE. */

  /* This session only. Renames in place when the row has no sets yet;
   * otherwise supersedes — the original row (and its logged sets) stays,
   * a fresh row with the new name takes over the remaining target sets at
   * the same position, so the next getCurrentSet() call finds it exactly
   * where the old exercise was. */
  async swapExercise(sessionExerciseId, newExerciseName) {
    const { c } = await requireClient();
    const { data: row, error: e1 } = await c.from('session_exercises')
      .select('*').eq('id', sessionExerciseId).single();
    if (e1) throw e1;

    const loggedCount = await countLoggedSets(c, sessionExerciseId);
    if (!requiresSupersede(loggedCount)) {
      const { error } = await c.from('session_exercises')
        .update({ exercise_name: newExerciseName }).eq('id', sessionExerciseId);
      if (error) throw error;
      return;
    }

    await supersede(c, row, newExerciseName, `superseded: swapped to ${newExerciseName}`);
  },

  /* Future sessions too. `fromDate` defaults to today so yesterday's record
   * is never touched — a session dated today IS included, so a same-day
   * partly-logged session still gets edited: its already-logged sets stay
   * on the (now superseded) original row, and a fresh row picks up the
   * remaining sets for today, same as swapExercise. Applied one matching
   * row at a time — a block has at most a few dozen sessions, so this
   * favours the same free/supersede logic as swapExercise over a bulk
   * query that would have to duplicate it. */
  async replaceExerciseInBlock(mesocycleId, oldName, newName, { fromDate } = {}) {
    const { c } = await requireClient();
    const from = fromDate || localDateStr();

    const { data: sessions, error: e1 } = await c.from('sessions').select('id')
      .eq('mesocycle_id', mesocycleId)
      .gte('date', from);
    if (e1) throw e1;
    if (!sessions || !sessions.length) return;

    const { data: rows, error: e2 } = await c.from('session_exercises').select('*')
      .in('session_id', sessions.map((s) => s.id))
      .eq('exercise_name', oldName);
    if (e2) throw e2;

    for (const row of rows || []) {
      const loggedCount = await countLoggedSets(c, row.id);
      if (!requiresSupersede(loggedCount)) {
        const { error } = await c.from('session_exercises')
          .update({ exercise_name: newName }).eq('id', row.id);
        if (error) throw error;
        continue;
      }
      await supersede(c, row, newName, `superseded: swapped to ${newName}`);
    }
  },

  /* Targets only — never touches `sets`, so it is safe to update in place
   * regardless of how many sets are already logged. A lowered target_sets
   * below the logged count just means resolveCursor stops asking for more;
   * the sets already logged stay exactly as recorded. */
  async updateTargets(sessionExerciseId, targets = {}) {
    const { c } = await requireClient();
    const patch = {};
    if (targets.targetSets !== undefined) patch.target_sets = targets.targetSets;
    if (targets.targetRepLow !== undefined) patch.target_rep_low = targets.targetRepLow;
    if (targets.targetRepHigh !== undefined) patch.target_rep_high = targets.targetRepHigh;
    if (targets.targetRir !== undefined) patch.target_rir = targets.targetRir;

    const { error } = await c.from('session_exercises').update(patch).eq('id', sessionExerciseId);
    if (error) throw error;
  },

  /* Appends to one session, positioned after whatever is already there. No
   * supersede case — a brand-new row has no history to preserve. */
  async addExerciseToSession(sessionId, exerciseName, targets = {}) {
    const { c } = await requireClient();
    const { data: last, error: e1 } = await c.from('session_exercises')
      .select('position').eq('session_id', sessionId)
      .order('position', { ascending: false }).limit(1).maybeSingle();
    if (e1) throw e1;

    const { data, error: e2 } = await c.from('session_exercises').insert({
      session_id: sessionId,
      exercise_name: exerciseName,
      position: (last?.position || 0) + 1,
      target_sets: targets.targetSets ?? null,
      target_rep_low: targets.targetRepLow ?? null,
      target_rep_high: targets.targetRepHigh ?? null,
      target_rir: targets.targetRir ?? null,
    }).select().single();
    if (e2) throw e2;
    return data;
  },

  /* Deletes outright when the row has no logged sets — nothing to lose.
   * Otherwise marks it aside the same way supersede() does, minus the
   * replacement row: the exercise simply stops being asked for by
   * resolveCursor, and its logged sets stay exactly as recorded. */
  async removeExerciseFromSession(sessionExerciseId) {
    const { c } = await requireClient();
    const loggedCount = await countLoggedSets(c, sessionExerciseId);

    if (!requiresSupersede(loggedCount)) {
      const { error } = await c.from('session_exercises').delete().eq('id', sessionExerciseId);
      if (error) throw error;
      return;
    }

    const { error } = await c.from('session_exercises')
      .update({ skipped_reason: 'superseded: removed' })
      .eq('id', sessionExerciseId);
    if (error) throw error;
  },

  /* Read-only: sessions of a block from `fromDate` (default today) onward,
   * each with its exercise rows and how many sets are already logged
   * against each — everything the "edit active block" view needs to
   * render and to warn before a swap/remove would supersede. Degrades to
   * [], same convention as getSessionPlan/listMesocycles. */
  async getUpcomingSessions(mesocycleId, { fromDate } = {}) {
    const c = await getClient();
    if (!c) return [];
    const { data: { user } } = await c.auth.getUser();
    if (!user) return [];

    const from = fromDate || localDateStr();
    const { data: sessions, error: e1 } = await c.from('sessions').select('*')
      .eq('mesocycle_id', mesocycleId)
      .gte('date', from)
      .order('date', { ascending: true });
    if (e1) throw e1;
    if (!sessions || !sessions.length) return [];

    const sessionIds = sessions.map((s) => s.id);
    const { data: exercises, error: e2 } = await c.from('session_exercises').select('*')
      .in('session_id', sessionIds)
      .order('position', { ascending: true });
    if (e2) throw e2;

    const exIds = (exercises || []).map((e) => e.id);
    let sets = [];
    if (exIds.length) {
      const { data, error: e3 } = await c.from('sets').select('session_exercise_id')
        .in('session_exercise_id', exIds);
      if (e3) throw e3;
      sets = data || [];
    }
    const loggedCounts = new Map();
    for (const s of sets) {
      loggedCounts.set(s.session_exercise_id, (loggedCounts.get(s.session_exercise_id) || 0) + 1);
    }

    return sessions.map((s) => ({
      sessionId: s.id,
      date: s.date,
      name: s.name,
      exercises: (exercises || []).filter((e) => e.session_id === s.id).map((e) => ({
        sessionExerciseId: e.id,
        exerciseName: e.exercise_name,
        targetSets: e.target_sets,
        targetRepLow: e.target_rep_low,
        targetRepHigh: e.target_rep_high,
        targetRir: e.target_rir,
        skippedReason: e.skipped_reason,
        setsLogged: loggedCounts.get(e.id) || 0,
      })),
    }));
  },
};
