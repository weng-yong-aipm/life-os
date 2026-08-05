/* Pure plan logic — no I/O, no DOM. Everything here is a function of WEEKS plus a
 * set of completed task ids, so it is unit-testable and cheap to reason about. */

import { WEEKS } from './plan-data.js';

/** Which week contains `today` (YYYY-MM-DD). Before W1 → W1; after W13 → W13. */
export function currentWeek(today, weeks = WEEKS) {
  const inRange = weeks.find((w) => today >= w.start && today <= w.end);
  if (inRange) return inRange;
  if (today < weeks[0].start) return weeks[0];
  return weeks[weeks.length - 1];
}

/** Overall completion across every task in the plan. */
export function progress(doneIds, weeks = WEEKS) {
  const all = weeks.flatMap((w) => w.tasks);
  const done = all.filter((t) => doneIds.has(t.id)).length;
  return { total: all.length, done, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

/** Completion for one week. */
export function weekProgress(week, doneIds) {
  const done = week.tasks.filter((t) => doneIds.has(t.id)).length;
  return { total: week.tasks.length, done, pct: week.tasks.length ? Math.round((done / week.tasks.length) * 100) : 0 };
}

/**
 * Tasks that are overdue: in a week that has already ended, and still not done.
 * Sorted oldest first, because the oldest one is usually the real blocker.
 */
export function overdue(today, doneIds, weeks = WEEKS) {
  return weeks
    .filter((w) => w.end < today)
    .flatMap((w) => w.tasks.filter((t) => !doneIds.has(t.id)).map((t) => ({ ...t, week: w.week, end: w.end })));
}

/**
 * The split that matters. 'me' tasks need a person, an account or a conversation;
 * 'build' tasks can be done at a desk. When build races ahead of me, the plan is
 * producing artefacts nobody has asked for yet — which is the documented failure mode.
 */
export function ownerSplit(doneIds, weeks = WEEKS) {
  const all = weeks.flatMap((w) => w.tasks);
  const count = (owner) => {
    const rows = all.filter((t) => t.owner === owner);
    const done = rows.filter((t) => doneIds.has(t.id)).length;
    return { total: rows.length, done, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 };
  };
  return { me: count('me'), build: count('build') };
}

/**
 * True when engineering has run ahead of the work that needs a person.
 *
 * Two triggers, because the sharper one is not a gap at all: having shipped something while
 * having asked nobody anything is the failure mode in its purest form, whatever the percentages
 * say. A 20-point gap is the softer version of the same thing.
 */
export function buildIsOutrunningMe(doneIds, weeks = WEEKS) {
  const s = ownerSplit(doneIds, weeks);
  if (s.me.done === 0 && s.build.done > 0) return true;
  return s.build.pct - s.me.pct > 20;
}

/** The next unfinished task, scanning forward from the current week. */
export function nextTask(today, doneIds, weeks = WEEKS) {
  const from = currentWeek(today, weeks).week;
  for (const w of weeks.filter((x) => x.week >= from)) {
    const t = w.tasks.find((x) => !doneIds.has(x.id));
    if (t) return { ...t, week: w.week };
  }
  return null;
}
