/* Pure catalogue queries over health/data/exercises.json (+ optional
 * health/data/exercise-media.json) — zero I/O, the only tested layer of the
 * training module. See docs/superpowers/specs/2026-08-06-training-module-design.md §1. */

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

/** Every distinct primary muscle across the catalogue, sorted, for a filter dropdown. */
export function muscleList(exercises) {
  const set = new Set();
  for (const e of exercises) for (const m of e.primaryMuscles || []) set.add(m);
  return [...set].sort();
}

/** Exercises whose primaryMuscles includes `muscle` (case-insensitive). No filter = everything. */
export function byMuscle(exercises, muscle) {
  if (!muscle) return exercises;
  const m = norm(muscle);
  return exercises.filter((e) => (e.primaryMuscles || []).some((p) => norm(p) === m));
}

/** Exercises whose name contains `query` (case-insensitive substring). No query = everything. */
export function search(exercises, query) {
  if (!query) return exercises;
  const q = norm(query);
  return exercises.filter((e) => norm(e.name).includes(q));
}

/** The media record for an exercise name, or null if none was mirrored. */
export function mediaFor(media, name) {
  const n = norm(name);
  return media.find((m) => norm(m.exercise) === n) || null;
}
