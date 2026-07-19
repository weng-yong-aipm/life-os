/* Pure MET-based calorie-burn estimate — no I/O.
 * kcal = MET × bodyweight(kg) × duration(hours) */
export function estimateBurn({ met, weightKg, durationMin } = {}) {
  const m = Number(met) || 0;
  const w = Number(weightKg) || 70;
  const mins = Number(durationMin) || 0;
  if (!m || !mins) return 0;
  return m * w * (mins / 60);
}
