import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleepDurationMin, formatDuration, averageDuration, sleepTimestamps } from './sleep.js';
import { localDateStr } from '../shared/local-date.js';

test('sleepDurationMin computes minutes between bed and wake', () => {
  assert.equal(sleepDurationMin('2026-08-04T23:00:00+08:00', '2026-08-05T07:00:00+08:00'), 480);
});

test('sleepDurationMin handles crossing midnight', () => {
  assert.equal(sleepDurationMin('2026-08-04T22:30:00+08:00', '2026-08-05T06:15:00+08:00'), 465);
});

test('sleepDurationMin returns null when either end is missing', () => {
  assert.equal(sleepDurationMin(null, '2026-08-05T07:00:00+08:00'), null);
  assert.equal(sleepDurationMin('2026-08-04T23:00:00+08:00', null), null);
  assert.equal(sleepDurationMin(null, null), null);
});

test('sleepDurationMin returns null when wake is before bed', () => {
  assert.equal(sleepDurationMin('2026-08-05T07:00:00+08:00', '2026-08-04T23:00:00+08:00'), null);
});

test('formatDuration renders hours and minutes', () => {
  assert.equal(formatDuration(480), '8h 0m');
  assert.equal(formatDuration(465), '7h 45m');
  assert.equal(formatDuration(59), '0h 59m');
});

test('formatDuration renders an em dash for null', () => {
  assert.equal(formatDuration(null), '—');
});

test('averageDuration averages the rows that have a duration', () => {
  const rows = [{ durationMin: 480 }, { durationMin: 420 }, { durationMin: null }];
  assert.equal(averageDuration(rows), 450);
});

test('averageDuration returns null for no usable rows', () => {
  assert.equal(averageDuration([]), null);
  assert.equal(averageDuration([{ durationMin: null }]), null);
});

test('sleepTimestamps shifts a late (bh >= 12) bed time to the previous local day', () => {
  const { bedAt, wakeAt } = sleepTimestamps('2026-08-05', '23:00', '07:00');
  assert.equal(localDateStr(new Date(bedAt)), '2026-08-04');
  assert.equal(localDateStr(new Date(wakeAt)), '2026-08-05');
  assert.equal(sleepDurationMin(bedAt, wakeAt), 480);
});

test('sleepTimestamps keeps an early-morning (bh < 12) bed time on the same local day', () => {
  const { bedAt, wakeAt } = sleepTimestamps('2026-08-05', '01:00', '07:00');
  assert.equal(localDateStr(new Date(bedAt)), '2026-08-05');
  assert.equal(localDateStr(new Date(wakeAt)), '2026-08-05');
  assert.equal(sleepDurationMin(bedAt, wakeAt), 360);
});

test('sleepTimestamps returns nulls when bed or wake time is missing', () => {
  assert.deepEqual(sleepTimestamps('2026-08-05', null, '07:00'), { bedAt: null, wakeAt: null });
  assert.deepEqual(sleepTimestamps('2026-08-05', '23:00', null), { bedAt: null, wakeAt: null });
  assert.deepEqual(sleepTimestamps('2026-08-05', null, null), { bedAt: null, wakeAt: null });
});
