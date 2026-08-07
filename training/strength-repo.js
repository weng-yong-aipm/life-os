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
import { resolveCursor, suggestSet, buildProgressionSeries } from './strength.js';

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
};
