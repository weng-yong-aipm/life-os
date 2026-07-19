import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateBurn } from './calories-burned.js';

test('estimateBurn = MET * weight * hours', () => {
  // 8 MET, 70kg, 30min (0.5h) => 280
  assert.equal(estimateBurn({ met: 8, weightKg: 70, durationMin: 30 }), 280);
});

test('estimateBurn defaults weight to 70kg when missing', () => {
  assert.equal(estimateBurn({ met: 6, durationMin: 60 }), 420);
});

test('estimateBurn returns 0 when duration missing', () => {
  assert.equal(estimateBurn({ met: 8, weightKg: 80 }), 0);
});

test('estimateBurn returns 0 when met missing', () => {
  assert.equal(estimateBurn({ weightKg: 80, durationMin: 30 }), 0);
});
