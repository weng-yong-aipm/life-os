import { classifyDay, calculatePay } from './pay-calc.js';
import { holidaySetForYear } from './holidays-repo.js';
import { WorkHoursRepo } from './work-hours-repo.js';
import { PaySettingsRepo } from './pay-settings-repo.js';
import { parseReceiptPhoto, saveReceipt, spendByCategory, caloriesByDay } from './receipts-repo.js';

initTabs();
initSpendingTab();
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

/* ---------------- Spending tab ---------------- */

let pendingParse = null;

function initSpendingTab() {
  document.getElementById('receipt-form').addEventListener('submit', onScanReceipt);
  document.getElementById('add-item-row').addEventListener('click', () => addItemRow({}));
  document.getElementById('save-receipt').addEventListener('click', onSaveReceipt);
  refreshSpendingDashboards();
}

async function onScanReceipt(e) {
  e.preventDefault();
  const file = document.getElementById('receipt-photo').files[0];
  const status = document.getElementById('receipt-status');
  if (!file) return;

  status.textContent = 'Uploading and scanning...';
  try {
    pendingParse = await parseReceiptPhoto(file);
    showPreview(pendingParse.extracted);
    status.textContent = '';
  } catch (err) {
    status.textContent = `Could not scan automatically (${err.message}). Enter items manually below.`;
    pendingParse = { storagePath: null, extracted: { merchant: null, purchased_at: null, items: [] } };
    showPreview(pendingParse.extracted);
  }
}

function showPreview(extracted) {
  document.getElementById('receipt-preview').hidden = false;
  document.getElementById('preview-merchant').value = extracted.merchant || '';
  document.getElementById('preview-date').value = extracted.purchased_at || '';
  const tbody = document.querySelector('#preview-items tbody');
  tbody.innerHTML = '';
  (extracted.items || []).forEach(addItemRow);
}

function addItemRow(item) {
  const tbody = document.querySelector('#preview-items tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="item-name" value="${item.name || ''}" placeholder="Item" /></td>
    <td><input type="number" step="0.01" class="item-price" value="${item.price ?? ''}" placeholder="Price" /></td>
    <td><input type="text" class="item-category" value="${item.category || 'other'}" placeholder="Category" /></td>
    <td><input type="number" class="item-calories" value="${item.calories ?? ''}" placeholder="kcal (est.)" /></td>
    <td><button type="button" class="remove-item">Remove</button></td>
  `;
  tr.querySelector('.remove-item').addEventListener('click', () => tr.remove());
  tbody.appendChild(tr);
}

async function onSaveReceipt() {
  const status = document.getElementById('receipt-status');
  const rows = [...document.querySelectorAll('#preview-items tbody tr')].map((tr) => ({
    name: tr.querySelector('.item-name').value,
    price: parseFloat(tr.querySelector('.item-price').value) || null,
    category: tr.querySelector('.item-category').value || 'other',
    calories: parseFloat(tr.querySelector('.item-calories').value) || null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    editedByUser: true,
  }));

  try {
    await saveReceipt({
      storagePath: pendingParse?.storagePath,
      merchant: document.getElementById('preview-merchant').value || null,
      purchasedAt: document.getElementById('preview-date').value || null,
      items: rows,
    });
    document.getElementById('receipt-preview').hidden = true;
    document.getElementById('receipt-form').reset();
    status.textContent = 'Saved.';
    pendingParse = null;
    refreshSpendingDashboards();
  } catch (err) {
    status.textContent = `Could not save (${err.message}). Try again once you're online.`;
  }
}

async function refreshSpendingDashboards() {
  const [byCategory, byDay] = await Promise.all([spendByCategory(), caloriesByDay()]);
  document.getElementById('spend-by-category').innerHTML = Object.entries(byCategory)
    .map(([cat, total]) => `<li>${cat}: ${total.toFixed(2)}</li>`)
    .join('');
  document.getElementById('calories-by-day').innerHTML = Object.entries(byDay)
    .map(([day, kcal]) => `<li>${day}: ${Math.round(kcal)} kcal</li>`)
    .join('');
}
