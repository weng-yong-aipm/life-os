/* Pure training logic — zero I/O, the only tested layer of the training
 * module (phase 3b). See docs/superpowers/specs/2026-08-06-training-module-design.md §1-§2.
 *
 * All three functions take already-fetched data and return a value; none of
 * them touch a network or a database. Fetching (last session's sets, a
 * session's plan, etc.) is the repo layer's job — out of scope here. */

/* Thresholds below are guesses, not measurements — there is no real training
 * data yet. Expect to tune both once some exists. */
const LOAD_INCREMENT_KG = 2.5;
const PLATEAU_WINDOW = 3;
const PLATEAU_TOLERANCE = 0.02;

function volumeOf(set) {
  return (set.weightKg || 0) * (set.reps || 0);
}

function bestSetInGroup(sets) {
  return sets.reduce((best, s) => {
    if (!best) return s;
    if (volumeOf(s) > volumeOf(best)) return s;
    if (volumeOf(s) === volumeOf(best) && (s.weightKg || 0) > (best.weightKg || 0)) return s;
    return best;
  }, null);
}

/**
 * Where to log next, recomputed from scratch every call — there is no stored
 * cursor. A refresh, a crash, a phone locking mid-set, or logging from a
 * second device must all land on the correct next set because position is
 * derived from (plan, sets already logged), never remembered.
 *
 * @param sessionPlan  [{ sessionExerciseId, position, targetSets, skippedReason }]
 * @param loggedSets   [{ sessionExerciseId, setNo }]
 * @returns { sessionExerciseId, setNumber } for the lowest unfilled set number
 *   of the first non-skipped, non-complete exercise (in position order), or
 *   the string 'session_complete' once every exercise is done.
 */
export function resolveCursor(sessionPlan, loggedSets) {
  const plan = [...sessionPlan].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const exercise of plan) {
    if (exercise.skippedReason) continue;

    const targetSets = exercise.targetSets || 0;
    if (targetSets <= 0) continue;

    const logged = new Set(
      loggedSets
        .filter((s) => s.sessionExerciseId === exercise.sessionExerciseId)
        .map((s) => s.setNo)
    );

    for (let setNumber = 1; setNumber <= targetSets; setNumber++) {
      if (!logged.has(setNumber)) {
        return { sessionExerciseId: exercise.sessionExerciseId, setNumber };
      }
    }
  }

  return 'session_complete';
}

/**
 * Double progression: pre-fill from the last session's numbers for this
 * exercise; when the last session hit the top of the target rep range at or
 * below target RIR, suggest a load increase instead. Cold start (no history)
 * falls back to the target verbatim.
 *
 * @param target          { repLow, repHigh, rir }
 * @param exerciseHistory [{ weightKg, reps, rir }] — the last session's sets
 *   for this exercise (the repo layer decides what "last session" means).
 * @returns { weightKg, reps, rir, source } — source is 'target' (no
 *   history), 'last-session' (prefilled), or 'progression' (load increase).
 */
export function suggestSet(target, exerciseHistory) {
  if (!exerciseHistory || exerciseHistory.length === 0) {
    return { weightKg: null, reps: target.repLow, rir: target.rir, source: 'target' };
  }

  const last = bestSetInGroup(exerciseHistory);
  const hitTopOfRange = last.reps >= target.repHigh && last.rir <= target.rir;

  if (hitTopOfRange) {
    return {
      weightKg: (last.weightKg || 0) + LOAD_INCREMENT_KG,
      reps: target.repLow,
      rir: target.rir,
      source: 'progression',
    };
  }

  return { weightKg: last.weightKg, reps: last.reps, rir: last.rir, source: 'last-session' };
}

/**
 * Per-session progression points (best weight x reps per session, by
 * volume), sorted chronologically, with a naive plateau flag: a point is
 * plateaued when it and the PLATEAU_WINDOW-1 points before it all sit within
 * PLATEAU_TOLERANCE of each other's volume. Fewer than PLATEAU_WINDOW points
 * is insufficient data — nothing is flagged.
 *
 * @param sets [{ sessionId?, date, weightKg, reps }] — sets already joined
 *   to their session, one exercise's worth, any order.
 * @returns [{ sessionId, date, weightKg, reps, volume, plateaued }]
 */
export function buildProgressionSeries(sets) {
  const bySession = new Map();
  for (const s of sets) {
    const key = s.sessionId ?? s.date;
    if (!bySession.has(key)) bySession.set(key, { sessionId: s.sessionId, date: s.date, sets: [] });
    bySession.get(key).sets.push(s);
  }

  const points = [...bySession.values()]
    .map((group) => {
      const best = bestSetInGroup(group.sets);
      return {
        sessionId: group.sessionId,
        date: group.date,
        weightKg: best.weightKg,
        reps: best.reps,
        volume: volumeOf(best),
      };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  for (let i = 0; i < points.length; i++) {
    if (i < PLATEAU_WINDOW - 1) {
      points[i].plateaued = false;
      continue;
    }
    const window = points.slice(i - PLATEAU_WINDOW + 1, i + 1).map((p) => p.volume);
    const max = Math.max(...window);
    const min = Math.min(...window);
    points[i].plateaued = max > 0 && (max - min) / max <= PLATEAU_TOLERANCE;
  }

  return points;
}
