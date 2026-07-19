import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portionScale, dailyTotals, compareToTarget } from './nutrition.js';

test('portionScale scales all macros by servings', () => {
  const food = { kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 5 };
  assert.deepEqual(portionScale(food, 1.5), { calories: 300, proteinG: 15, carbsG: 30, fatG: 7.5 });
});

test('portionScale treats missing macros as 0', () => {
  assert.deepEqual(portionScale({ kcal: 100 }, 2), { calories: 200, proteinG: 0, carbsG: 0, fatG: 0 });
});

test('dailyTotals sums entries and ignores nullish', () => {
  const meals = [
    { calories: 300, proteinG: 15, carbsG: 30, fatG: 7 },
    { calories: 200, proteinG: null, carbsG: 10, fatG: undefined },
  ];
  assert.deepEqual(dailyTotals(meals), { calories: 500, proteinG: 15, carbsG: 40, fatG: 7 });
});

test('dailyTotals of empty list is all zeros', () => {
  assert.deepEqual(dailyTotals([]), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
});

test('compareToTarget computes remaining and pct', () => {
  const r = compareToTarget({ calories: 500 }, 2000);
  assert.equal(r.remaining, 1500);
  assert.equal(r.pct, 25);
});

test('compareToTarget with zero/absent target yields null pct, no divide-by-zero', () => {
  const r = compareToTarget({ calories: 500 }, 0);
  assert.equal(r.pct, null);
  assert.equal(r.remaining, -500);
});
