import { classifyDay, calculatePay } from './pay-calc.js';
import { holidaySetForYear } from './holidays-repo.js';
import { WorkHoursRepo } from './work-hours-repo.js';
import { PaySettingsRepo } from './pay-settings-repo.js';

initTabs();
initOtPayTab();

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

async function initOtPayTab() {
  const settings = await PaySettingsRepo.get();
  document.getElementById('settings-base-rate').value = settings.baseHourlyRate;
  document.getElementById('settings-weekend-mult').value = settings.weekendMultiplier;
  document.getElementById('settings-holiday-mult').value = settings.holidayMultiplier;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await PaySettingsRepo.upsert({
      baseHourlyRate: parseFloat(document.getElementById('settings-base-rate').value),
      weekendMultiplier: parseFloat(document.getElementById('settings-weekend-mult').value),
      holidayMultiplier: parseFloat(document.getElementById('settings-holiday-mult').value),
      currency: settings.currency,
    });
  });

  document.getElementById('hours-form').addEventListener('submit', onLogHours);
  refreshHoursSummary();
}

async function onLogHours(e) {
  e.preventDefault();
  const status = document.getElementById('hours-status');
  const workDate = document.getElementById('hours-date').value;
  const hours = parseFloat(document.getElementById('hours-worked').value);
  const manualHoliday = document.getElementById('hours-manual-holiday').checked;

  const settings = await PaySettingsRepo.get();
  const year = Number(workDate.slice(0, 4));
  const holidaySet = holidaySetForYear(year);
  const dayType = manualHoliday ? 'holiday' : classifyDay(workDate, holidaySet);
  const computedPay = calculatePay({ hours, dayType, settings });

  await WorkHoursRepo.create({ workDate, hours, dayType, computedPay });
  status.textContent = `Logged: ${dayType}, pay ${computedPay.toFixed(2)} ${settings.currency}`;
  document.getElementById('hours-form').reset();
  refreshHoursSummary();
}

async function refreshHoursSummary() {
  const entries = await WorkHoursRepo.list();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = entries.filter((e) => e.workDate.slice(0, 7) === currentMonth);
  const totalsByType = {};
  for (const e of thisMonth) {
    totalsByType[e.dayType] = totalsByType[e.dayType] || { hours: 0, pay: 0 };
    totalsByType[e.dayType].hours += e.hours;
    totalsByType[e.dayType].pay += e.computedPay;
  }
  const tbody = document.querySelector('#hours-summary tbody');
  tbody.innerHTML = Object.entries(totalsByType)
    .map(([type, t]) => `<tr><td>${type}</td><td>${t.hours}h</td><td>${t.pay.toFixed(2)}</td></tr>`)
    .join('');
}
