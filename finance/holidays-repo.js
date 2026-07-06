import { ALL_HOLIDAYS } from './malaysia-holidays.js';

export function holidaySetForYear(year) {
  const prefix = String(year);
  return new Set(
    ALL_HOLIDAYS.filter((h) => h.date.startsWith(prefix)).map((h) => h.date)
  );
}

export function nameForDate(dateStr) {
  const match = ALL_HOLIDAYS.find((h) => h.date === dateStr);
  return match ? match.name : null;
}
