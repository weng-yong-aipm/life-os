import test from 'node:test';
import assert from 'node:assert/strict';
import { holidaySetForYear, nameForDate } from './holidays-repo.js';

test('holidaySetForYear returns only dates for the given year', () => {
  const set2026 = holidaySetForYear(2026);
  assert.ok(set2026.has('2026-08-31'));
  assert.ok(!set2026.has('2025-08-31'));
});

test('holidaySetForYear returns an empty set for a year with no data yet', () => {
  const set2030 = holidaySetForYear(2030);
  assert.equal(set2030.size, 0);
});

test('nameForDate returns the holiday name for a known date', () => {
  assert.equal(nameForDate('2026-08-31'), 'Merdeka Day (National Day)');
});

test('nameForDate returns null for a non-holiday date', () => {
  assert.equal(nameForDate('2026-07-13'), null);
});
