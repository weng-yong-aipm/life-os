/* The calendar date in the runtime's LOCAL timezone, as 'YYYY-MM-DD'.
 *
 * `new Date().toISOString().slice(0,10)` returns the UTC date, which in MYT
 * (UTC+8) files anything logged before 08:00 local under yesterday — the exact
 * breakfast and wake-time window this app is for. Use this everywhere a user
 * sees or picks "today". */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
