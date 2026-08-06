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

/* A time input gives 'HH:MM' with no date. Bed time before ~12:00 is treated
 * as the same morning; anything later is the previous evening — otherwise a
 * 23:00 bedtime and a 07:00 wake on the same date would compute as negative. */
export function sleepTimestamps(sleptOn, bedTime, wakeTime) {
  if (!bedTime || !wakeTime) return { bedAt: null, wakeAt: null };
  const [bh] = bedTime.split(':').map(Number);
  const bedDate = new Date(`${sleptOn}T${bedTime}:00`);
  if (bh >= 12) bedDate.setDate(bedDate.getDate() - 1);
  const wakeDate = new Date(`${sleptOn}T${wakeTime}:00`);
  return { bedAt: bedDate.toISOString(), wakeAt: wakeDate.toISOString() };
}

export function averageDuration(rows) {
  const usable = (rows || [])
    .filter((r) => r?.durationMin != null)
    .map((r) => Number(r.durationMin))
    .filter((n) => Number.isFinite(n));
  if (!usable.length) return null;
  return Math.round(usable.reduce((a, b) => a + b, 0) / usable.length);
}
