/* Pure sleep math — no I/O. */

/* Minutes between two ISO timestamps. Returns null when either end is missing
 * or the pair is inverted, so a half-filled form can never store a negative or
 * absurd duration. */
export function sleepDurationMin(bedAt, wakeAt) {
  if (!bedAt || !wakeAt) return null;
  const bed = Date.parse(bedAt);
  const wake = Date.parse(wakeAt);
  if (!Number.isFinite(bed) || !Number.isFinite(wake)) return null;
  if (wake <= bed) return null;
  return Math.round((wake - bed) / 60000);
}

export function formatDuration(min) {
  if (min == null || !Number.isFinite(Number(min))) return '—';
  const m = Math.max(0, Math.round(Number(min)));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function averageDuration(rows) {
  const usable = (rows || [])
    .filter((r) => r?.durationMin != null)
    .map((r) => Number(r.durationMin))
    .filter((n) => Number.isFinite(n));
  if (!usable.length) return null;
  return Math.round(usable.reduce((a, b) => a + b, 0) / usable.length);
}
