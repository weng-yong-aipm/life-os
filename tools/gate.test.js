import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateStr, countStreak, tableVerdict, moduleVerdict, gatePasses,
} from './gate.mjs';

const TODAY = '2026-08-16';
const back = (n) => {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - n);
  return localDateStr(d);
};
/* Seven days ending today, in every one of the three streams. */
const week = [0, 1, 2, 3, 4, 5, 6].map(back);

test('localDateStr uses the LOCAL calendar day, not UTC', () => {
  // 01:30 local on the 16th. `toISOString().slice(0,10)` — the pattern used at
  // three sites in this repo — reports the 15th east of Greenwich.
  assert.equal(localDateStr(new Date(2026, 7, 16, 1, 30)), '2026-08-16');
  assert.equal(localDateStr(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
});

test('the streak today is 0 - the state that made this gate necessary', () => {
  assert.equal(countStreak(TODAY, [], [], []), 0);
});

test('113 learning rows and nothing else is still a 0-day streak', () => {
  // The live shape on 2026-08-16: learning_sessions has a batch import, meals
  // and sleep have nothing. A gate that counted any one stream would report a
  // streak here.
  const batch = ['2026-07-29', '2026-07-30', '2026-07-31'];
  assert.equal(countStreak(TODAY, [], [], batch), 0);
});

test('seven complete days back from today counts as 7', () => {
  assert.equal(countStreak(TODAY, week, week, week), 7);
});

test('the streak stops at the first gap and does not resume past it', () => {
  // Days 0-2 complete, day 3 missing, days 4-6 complete again.
  const withHole = week.filter((_, i) => i !== 3);
  assert.equal(countStreak(TODAY, withHole, withHole, withHole), 3);
});

test('a day missing ANY of the three streams breaks the streak', () => {
  const noSleepOnDay2 = week.filter((d) => d !== back(2));
  assert.equal(countStreak(TODAY, week, noSleepOnDay2, week), 2);
});

test('today itself missing means 0, however long the run behind it', () => {
  const yesterdayBack = week.slice(1);
  assert.equal(countStreak(TODAY, yesterdayBack, yesterdayBack, yesterdayBack), 0);
});

test('duplicate rows on one day do not inflate the streak', () => {
  const dupes = [back(0), back(0), back(0), back(1)];
  assert.equal(countStreak(TODAY, dupes, dupes, dupes), 2);
});

test('tableVerdict: rows present -> OK, zero rows -> EMPTY', () => {
  assert.equal(tableVerdict({ state: 'ok', rows: 113 }), 'OK');
  assert.equal(tableVerdict({ state: 'ok', rows: 1 }), 'OK');
  assert.equal(tableVerdict({ state: 'ok', rows: 0 }), 'EMPTY');
});

test('tableVerdict: a missing table is NOT an empty table', () => {
  assert.equal(tableVerdict({ state: 'missing', rows: null }), 'MISSING');
});

test('tableVerdict: unreachable data never reads as a pass', () => {
  // This is the defect class the repo keeps hitting: the check cannot see the
  // data and reports green. Every unobservable shape must land off 'OK'.
  assert.equal(tableVerdict({ state: 'unreachable', rows: null }), 'UNREACHABLE');
  assert.equal(tableVerdict({ state: 'ok', rows: null }), 'UNREACHABLE');
  assert.equal(tableVerdict({ state: 'ok', rows: undefined }), 'UNREACHABLE');
  assert.equal(tableVerdict({}), 'UNREACHABLE');
});

test('moduleVerdict takes the worst table, loudest-to-fix first', () => {
  assert.equal(moduleVerdict(['OK', 'OK']), 'OK');
  assert.equal(moduleVerdict(['OK', 'EMPTY']), 'EMPTY');
  assert.equal(moduleVerdict(['OK', 'EMPTY', 'MISSING']), 'MISSING');
  assert.equal(moduleVerdict(['EMPTY', 'MISSING', 'UNREACHABLE']), 'UNREACHABLE');
});

test('a module with no probed tables is UNREACHABLE, not OK', () => {
  // A module we forgot to probe must not pass by default.
  assert.equal(moduleVerdict([]), 'UNREACHABLE');
});

test('gatePasses is false whenever the row data is missing or unreachable', () => {
  assert.equal(gatePasses(['OK', 'OK', 'UNREACHABLE', 'OK']), false);
  assert.equal(gatePasses(['OK', 'MISSING']), false);
  assert.equal(gatePasses(['OK', 'EMPTY']), false);
  assert.equal(gatePasses([]), false, 'no modules observed is not a pass');
});

test('gatePasses is true only when every module has production rows', () => {
  assert.equal(gatePasses(['OK', 'OK', 'OK', 'OK']), true);
});

test("today's live verdicts fail the gate", () => {
  // Training/Finance/Health/Capture all at zero rows, learning imported.
  assert.equal(gatePasses(['EMPTY', 'EMPTY', 'EMPTY', 'EMPTY']), false);
});
