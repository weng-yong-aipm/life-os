import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, mergeSettings, isHidden } from './settings.js';

test('mergeSettings falls back to DEFAULTS for a null row', () => {
  assert.deepEqual(mergeSettings(null), DEFAULTS);
  assert.deepEqual(mergeSettings(undefined), DEFAULTS);
});

test('mergeSettings only overrides the fields a partial row provides', () => {
  const merged = mergeSettings({ daily_kcal_target: 2400, body_weight_kg: 82 });
  assert.equal(merged.dailyKcalTarget, 2400);
  assert.equal(merged.bodyWeightKg, 82);
  assert.equal(merged.dailyProteinTargetG, DEFAULTS.dailyProteinTargetG);
  assert.equal(merged.sleepTargetMin, DEFAULTS.sleepTargetMin);
  assert.deepEqual(merged.hiddenModules, DEFAULTS.hiddenModules);
});

test('mergeSettings treats a null/undefined hidden_modules as empty', () => {
  assert.deepEqual(mergeSettings({ hidden_modules: null }).hiddenModules, []);
  assert.deepEqual(mergeSettings({ hidden_modules: undefined }).hiddenModules, []);
  assert.deepEqual(mergeSettings({ hidden_modules: ['feed'] }).hiddenModules, ['feed']);
});

test('isHidden reports whether a module id is in hiddenModules', () => {
  const settings = mergeSettings({ hidden_modules: ['feed', 'invest'] });
  assert.equal(isHidden(settings, 'feed'), true);
  assert.equal(isHidden(settings, 'invest'), true);
  assert.equal(isHidden(settings, 'health'), false);
});

test('isHidden is safe against a missing hiddenModules field', () => {
  assert.equal(isHidden({}, 'health'), false);
});
