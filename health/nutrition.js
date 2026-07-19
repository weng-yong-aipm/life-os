/* Pure nutrition math — no I/O. */
const n = (v) => Number(v) || 0;

export function portionScale(food, servings) {
  const s = n(servings);
  return {
    calories: n(food.kcal) * s,
    proteinG: n(food.protein_g) * s,
    carbsG: n(food.carbs_g) * s,
    fatG: n(food.fat_g) * s,
  };
}

export function dailyTotals(meals) {
  return meals.reduce(
    (t, m) => ({
      calories: t.calories + n(m.calories),
      proteinG: t.proteinG + n(m.proteinG),
      carbsG: t.carbsG + n(m.carbsG),
      fatG: t.fatG + n(m.fatG),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

export function compareToTarget(totals, targetCalories) {
  const consumed = n(totals.calories);
  const target = n(targetCalories);
  return {
    consumed,
    target,
    remaining: target - consumed,
    pct: target > 0 ? Math.round((consumed / target) * 100) : null,
  };
}
