/* Pure Settings logic — no I/O. Defaults, row merging, and hidden-module lookup. */

export const DEFAULTS = {
  dailyKcalTarget: 2000,
  dailyProteinTargetG: 120,
  bodyWeightKg: 70,
  sleepTargetMin: 480,
  hiddenModules: [],
};

/* Every module id that can be hidden from the hub. 'settings' is deliberately
 * excluded — hiding it would strand the page that turns it back on. */
export const HIDEABLE_MODULES = ['finance', 'health', 'plan', 'career', 'learning', 'feed', 'improve', 'invest'];

/* Merge a possibly-null/partial Supabase row (snake_case columns) into a
 * complete, camelCase settings object. A row missing a column (a partial
 * update, or a row from before a column existed) falls back to that
 * column's default rather than surfacing as undefined. */
export function mergeSettings(row) {
  const r = row || {};
  return {
    dailyKcalTarget: r.daily_kcal_target ?? DEFAULTS.dailyKcalTarget,
    dailyProteinTargetG: r.daily_protein_target_g ?? DEFAULTS.dailyProteinTargetG,
    bodyWeightKg: r.body_weight_kg ?? DEFAULTS.bodyWeightKg,
    sleepTargetMin: r.sleep_target_min ?? DEFAULTS.sleepTargetMin,
    hiddenModules: r.hidden_modules ?? DEFAULTS.hiddenModules,
  };
}

export function isHidden(settings, moduleId) {
  return (settings?.hiddenModules || []).includes(moduleId);
}
