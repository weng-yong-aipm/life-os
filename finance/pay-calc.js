/* Pure pay-rate logic — no I/O, safe to unit test directly. */

export function classifyDay(dateStr, holidayDates) {
  if (holidayDates.has(dateStr)) return 'holiday';
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return (dow === 0 || dow === 6) ? 'weekend' : 'workday';
}

export function calculatePay({ hours, dayType, settings }) {
  const multiplier =
    dayType === 'holiday' ? settings.holidayMultiplier :
    dayType === 'weekend' ? settings.weekendMultiplier :
    1;
  return Math.round(hours * settings.baseHourlyRate * multiplier * 100) / 100;
}
