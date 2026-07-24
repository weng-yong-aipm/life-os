/* Pure learning-log aggregation — no I/O. */

/* ISO-week key like "2026-W30" for a YYYY-MM-DD date string. */
export function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  // shift to Thursday of this week (ISO weeks are Thursday-anchored)
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ft = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ft + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 864e5));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/* Summarize the sessions that fall in a given ISO week. */
export function summarizeWeek(sessions, weekKey) {
  const inWeek = sessions.filter((s) => s.learnedOn && isoWeekKey(s.learnedOn) === weekKey);
  const bySource = {};
  const byVerdict = { applied: 0, rejected: 0, considering: 0 };
  const byProject = {};
  const applied = [];
  const rejected = [];
  for (const s of inWeek) {
    bySource[s.source || 'other'] = (bySource[s.source || 'other'] || 0) + 1;
    const v = s.verdict || 'considering';
    byVerdict[v] = (byVerdict[v] || 0) + 1;
    const p = s.project || 'unassigned';
    byProject[p] = (byProject[p] || 0) + 1;
    if (v === 'applied') applied.push(s);
    if (v === 'rejected') rejected.push(s);
  }
  return { weekKey, total: inWeek.length, bySource, byVerdict, byProject, applied, rejected };
}
