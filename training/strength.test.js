import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCursor, suggestSet, buildProgressionSeries } from './strength.js';

test('resolveCursor with an empty plan returns session_complete', () => {
  assert.equal(resolveCursor([], []), 'session_complete');
});

test('resolveCursor mid-session lands on the next unfilled set', () => {
  const plan = [
    { sessionExerciseId: 'ex-1', position: 1, targetSets: 3 },
    { sessionExerciseId: 'ex-2', position: 2, targetSets: 3 },
  ];
  const loggedSets = [
    { sessionExerciseId: 'ex-1', setNo: 1 },
    { sessionExerciseId: 'ex-1', setNo: 2 },
  ];
  assert.deepEqual(resolveCursor(plan, loggedSets), { sessionExerciseId: 'ex-1', setNumber: 3 });
});

test('resolveCursor returns session_complete once every set is logged', () => {
  const plan = [{ sessionExerciseId: 'ex-1', position: 1, targetSets: 2 }];
  const loggedSets = [
    { sessionExerciseId: 'ex-1', setNo: 1 },
    { sessionExerciseId: 'ex-1', setNo: 2 },
  ];
  assert.equal(resolveCursor(plan, loggedSets), 'session_complete');
});

test('resolveCursor skips an exercise with a skippedReason', () => {
  const plan = [
    { sessionExerciseId: 'ex-1', position: 1, targetSets: 3, skippedReason: 'elbow' },
    { sessionExerciseId: 'ex-2', position: 2, targetSets: 3 },
  ];
  assert.deepEqual(resolveCursor(plan, []), { sessionExerciseId: 'ex-2', setNumber: 1 });
});

test('resolveCursor fills the gap when sets are logged out of order', () => {
  const plan = [{ sessionExerciseId: 'ex-1', position: 1, targetSets: 3 }];
  const loggedSets = [
    { sessionExerciseId: 'ex-1', setNo: 1 },
    { sessionExerciseId: 'ex-1', setNo: 3 },
  ];
  assert.deepEqual(resolveCursor(plan, loggedSets), { sessionExerciseId: 'ex-1', setNumber: 2 });
});

test('suggestSet with no history falls back to the target', () => {
  const target = { repLow: 8, repHigh: 12, rir: 2 };
  assert.deepEqual(suggestSet(target, []), { weightKg: null, reps: 8, rir: 2, source: 'target' });
  assert.deepEqual(suggestSet(target, null), { weightKg: null, reps: 8, rir: 2, source: 'target' });
});

test('suggestSet at target prefills from the last session, no load bump', () => {
  const target = { repLow: 8, repHigh: 12, rir: 2 };
  const history = [{ weightKg: 50, reps: 10, rir: 2 }];
  assert.deepEqual(suggestSet(target, history), {
    weightKg: 50,
    reps: 10,
    rir: 2,
    source: 'last-session',
  });
});

test('suggestSet above the rep range at or below target RIR suggests a load increase', () => {
  const target = { repLow: 8, repHigh: 12, rir: 2 };
  const history = [{ weightKg: 50, reps: 13, rir: 1 }];
  assert.deepEqual(suggestSet(target, history), {
    weightKg: 52.5,
    reps: 8,
    rir: 2,
    source: 'progression',
  });
});

test('suggestSet picks the heaviest set from a multi-set history', () => {
  const target = { repLow: 8, repHigh: 12, rir: 2 };
  const history = [
    { weightKg: 45, reps: 10, rir: 3 },
    { weightKg: 50, reps: 9, rir: 2 },
  ];
  assert.equal(suggestSet(target, history).weightKg, 50);
});

test('buildProgressionSeries on a rising series flags no plateau', () => {
  const sets = [
    { sessionId: 's1', date: '2026-07-01', weightKg: 40, reps: 10 },
    { sessionId: 's2', date: '2026-07-08', weightKg: 42.5, reps: 10 },
    { sessionId: 's3', date: '2026-07-15', weightKg: 45, reps: 10 },
    { sessionId: 's4', date: '2026-07-22', weightKg: 47.5, reps: 10 },
  ];
  const points = buildProgressionSeries(sets);
  assert.equal(points.length, 4);
  assert.deepEqual(points.map((p) => p.plateaued), [false, false, false, false]);
});

test('buildProgressionSeries on a flat series is detected as plateaued', () => {
  const sets = [
    { sessionId: 's1', date: '2026-07-01', weightKg: 50, reps: 10 },
    { sessionId: 's2', date: '2026-07-08', weightKg: 50, reps: 10 },
    { sessionId: 's3', date: '2026-07-15', weightKg: 50, reps: 10 },
    { sessionId: 's4', date: '2026-07-22', weightKg: 50, reps: 10 },
  ];
  const points = buildProgressionSeries(sets);
  assert.deepEqual(points.map((p) => p.plateaued), [false, false, true, true]);
});

test('buildProgressionSeries with insufficient data flags nothing and does not crash', () => {
  const sets = [{ sessionId: 's1', date: '2026-07-01', weightKg: 50, reps: 10 }];
  const points = buildProgressionSeries(sets);
  assert.equal(points.length, 1);
  assert.equal(points[0].plateaued, false);
});

test('buildProgressionSeries picks the best (highest volume) set per session and sorts by date', () => {
  const sets = [
    { sessionId: 's2', date: '2026-07-08', weightKg: 40, reps: 10 },
    { sessionId: 's2', date: '2026-07-08', weightKg: 50, reps: 8 },
    { sessionId: 's1', date: '2026-07-01', weightKg: 30, reps: 10 },
  ];
  const points = buildProgressionSeries(sets);
  assert.deepEqual(
    points.map((p) => p.sessionId),
    ['s1', 's2']
  );
  assert.equal(points[1].weightKg, 50);
  assert.equal(points[1].reps, 8);
});
