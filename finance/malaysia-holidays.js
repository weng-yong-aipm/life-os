/* Malaysia national public holidays.
 *
 * Best-effort list compiled 2026-07-06 from officeholidays.com and
 * calendar-malaysia.com. State-specific holidays (Thaipusam, state rulers'
 * birthdays, etc.) are NOT included — verify against your own state's
 * official gazette if those matter to you. Hari Raya dates are subject to
 * moon-sighting confirmation and may shift by a day near the observance.
 *
 * Add a new MALAYSIA_HOLIDAYS_<year> array every December for the coming
 * year and spread it into ALL_HOLIDAYS below.
 */

export const MALAYSIA_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-02-17', name: 'Chinese New Year' },
  { date: '2026-02-18', name: 'Chinese New Year Holiday' },
  { date: '2026-03-07', name: 'Nuzul Al-Quran' },
  { date: '2026-03-21', name: 'Hari Raya Aidilfitri' },
  { date: '2026-03-22', name: 'Hari Raya Aidilfitri Holiday' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-27', name: 'Hari Raya Haji' },
  { date: '2026-05-31', name: 'Wesak Day' },
  { date: '2026-06-01', name: 'Birthday of SPB Yang di-Pertuan Agong' },
  { date: '2026-06-17', name: 'Awal Muharram' },
  { date: '2026-08-25', name: 'Maulidur Rasul' },
  { date: '2026-08-31', name: 'Merdeka Day (National Day)' },
  { date: '2026-09-16', name: 'Malaysia Day' },
  { date: '2026-11-08', name: 'Deepavali' },
  { date: '2026-12-25', name: 'Christmas Day' },
];

export const ALL_HOLIDAYS = [...MALAYSIA_HOLIDAYS_2026];
