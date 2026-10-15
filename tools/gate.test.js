import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateStr, countTappedDays, TAP_TARGET, effectiveVerdict, tableVerdict, moduleVerdict, gatePasses,
} from './gate.mjs';

const TODAY = '2026-08-16';
const back = (n) => {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - n);
  return localDateStr(d);
};

test('localDateStr uses the LOCAL calendar day, not UTC', () => {
  // 01:30 local on the 16th. `toISOString().slice(0,10)` — the pattern used at
  // three sites in this repo — reports the 15th east of Greenwich.
  assert.equal(localDateStr(new Date(2026, 7, 16, 1, 30)), '2026-08-16');
  assert.equal(localDateStr(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
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

test('countTappedDays: 5 of the last 7 days, today included', () => {
  assert.equal(countTappedDays(TODAY, [back(0), back(1), back(3), back(4), back(6)]), 5);
  assert.ok(countTappedDays(TODAY, [back(0), back(1), back(3), back(4), back(6)]) >= TAP_TARGET);
});

test('countTappedDays: 4 of 7 fails the target', () => {
  assert.ok(countTappedDays(TODAY, [back(1), back(2), back(3), back(4)]) < TAP_TARGET);
});

test('countTappedDays: days older than the window and duplicates do not count', () => {
  assert.equal(countTappedDays(TODAY, [back(7), back(8), back(0), back(0)]), 1);
});

test('today unanswered still counts the other six days', () => {
  assert.equal(countTappedDays(TODAY, [1, 2, 3, 4, 5, 6].map(back)), 6);
});

test('a frozen module with 0 rows does not block', () => {
  assert.equal(effectiveVerdict({ frozen: true }, 'EMPTY'), 'FROZEN');
  assert.equal(gatePasses(['FROZEN', 'FROZEN', 'OK']), true);
});

test('an unfrozen module with 0 rows still blocks', () => {
  assert.equal(effectiveVerdict({}, 'EMPTY'), 'EMPTY');
  assert.equal(gatePasses(['FROZEN', 'EMPTY']), false);
});
