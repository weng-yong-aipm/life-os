import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekKey, summarizeWeek } from './weekly.js';

test('isoWeekKey computes ISO week', () => {
  // 2026-07-24 is a Friday in ISO week 30 of 2026
  assert.equal(isoWeekKey('2026-07-24'), '2026-W30');
  // Monday of the same week
  assert.equal(isoWeekKey('2026-07-20'), '2026-W30');
});

test('isoWeekKey rolls year boundary correctly', () => {
  // 2025-12-29 (Mon) belongs to ISO week 1 of 2026
  assert.equal(isoWeekKey('2025-12-29'), '2026-W01');
});

test('summarizeWeek buckets by source/verdict/project and lists applied+rejected', () => {
  const sessions = [
    { learnedOn: '2026-07-21', source: 'douyin', verdict: 'applied', project: 'life-os', title: 'A' },
    { learnedOn: '2026-07-22', source: 'instagram', verdict: 'rejected', project: 'life-os', title: 'B' },
    { learnedOn: '2026-07-23', source: 'douyin', verdict: 'considering', project: 'cockpit', title: 'C' },
    { learnedOn: '2026-07-10', source: 'douyin', verdict: 'applied', project: 'life-os', title: 'OLD' },
  ];
  const r = summarizeWeek(sessions, '2026-W30');
  assert.equal(r.total, 3);
  assert.deepEqual(r.bySource, { douyin: 2, instagram: 1 });
  assert.deepEqual(r.byVerdict, { applied: 1, rejected: 1, considering: 1 });
  assert.deepEqual(r.byProject, { 'life-os': 2, cockpit: 1 });
  assert.deepEqual(r.applied.map((s) => s.title), ['A']);
  assert.deepEqual(r.rejected.map((s) => s.title), ['B']);
});

test('summarizeWeek on empty week returns zeroed structure', () => {
  const r = summarizeWeek([], '2026-W30');
  assert.equal(r.total, 0);
  assert.deepEqual(r.byVerdict, { applied: 0, rejected: 0, considering: 0 });
  assert.deepEqual(r.applied, []);
});
