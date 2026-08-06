import { MealsRepo } from './meals-repo.js';
import { WorkoutsRepo } from './workouts-repo.js';
import { SleepRepo } from './sleep-repo.js';
import { portionScale, dailyTotals, compareToTarget } from './nutrition.js';
import { estimateBurn } from './calories-burned.js';
import { sleepDurationMin, formatDuration, averageDuration } from './sleep.js';
import { localDateStr } from '../shared/local-date.js';

const todayStr = () => localDateStr();
/* parseFloat(x) || null turns a legitimate 0 into null — a zero-calorie drink
 * would be stored as "unknown" rather than as zero. */
const numOrNull = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
let foods = [];
let exercises = [];
let pendingImagePath = null;

initTabs();
initMealTab();
initWorkoutTab();
initSleepTab();

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

/* ---------------- Meal tab ---------------- */

async function initMealTab() {
  document.getElementById('meal-date').value = todayStr();
  foods = await fetch('./data/foods.json').then((r) => r.json()).catch(() => []);
  const dl = document.getElementById('food-list');
  dl.innerHTML = foods.map((f) => `<option value="${f.name}"></option>`).join('');

  document.getElementById('food-add').addEventListener('click', onAddFood);
  document.getElementById('meal-photo-form').addEventListener('submit', onEstimatePhoto);
  document.getElementById('meal-save').addEventListener('click', onSaveMeal);
  document.getElementById('meal-target').addEventListener('input', refreshDaily);
  refreshDaily().catch(() => {});
}

function showMealPreview({ name, calories, proteinG, carbsG, fatG }) {
  document.getElementById('meal-preview').hidden = false;
  document.getElementById('meal-name').value = name || '';
  document.getElementById('meal-date').value = todayStr();
  document.getElementById('meal-cal').value = calories ?? '';
  document.getElementById('meal-protein').value = proteinG ?? '';
  document.getElementById('meal-carbs').value = carbsG ?? '';
  document.getElementById('meal-fat').value = fatG ?? '';
}

function onAddFood() {
  const name = document.getElementById('food-search').value.trim();
  const food = foods.find((f) => f.name === name);
  if (!food) { document.getElementById('meal-status').textContent = 'Pick a food from the list.'; return; }
  const servings = parseFloat(document.getElementById('food-servings').value) || 1;
  const scaled = portionScale(food, servings);
  showMealPreview({ name: `${food.name} × ${servings}`, ...scaled });
  document.getElementById('meal-status').textContent = '';
}

async function onEstimatePhoto(e) {
  e.preventDefault();
  const file = document.getElementById('meal-photo').files[0];
  const status = document.getElementById('meal-status');
  if (!file) return;
  status.textContent = 'Uploading and estimating...';
  try {
    const { storagePath, extracted } = await MealsRepo.estimatePhoto(file);
    pendingImagePath = storagePath;
    showMealPreview({
      name: extracted.name, calories: extracted.calories,
      proteinG: extracted.protein_g, carbsG: extracted.carbs_g, fatG: extracted.fat_g,
    });
    status.textContent = '';
  } catch (err) {
    status.textContent = `Could not estimate (${err.message}). Enter it manually below.`;
    pendingImagePath = err.storagePath || null;
    showMealPreview({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' });
  }
}

async function onSaveMeal() {
  const status = document.getElementById('meal-status');
  try {
    await MealsRepo.save({
      eatenAt: document.getElementById('meal-date').value || todayStr(),
      name: document.getElementById('meal-name').value || 'meal',
      source: pendingImagePath ? 'photo' : 'manual',
      imagePath: pendingImagePath,
      calories: numOrNull(document.getElementById('meal-cal').value),
      proteinG: numOrNull(document.getElementById('meal-protein').value),
      carbsG: numOrNull(document.getElementById('meal-carbs').value),
      fatG: numOrNull(document.getElementById('meal-fat').value),
    });
    pendingImagePath = null;
    document.getElementById('meal-preview').hidden = true;
    status.textContent = 'Saved.';
    refreshDaily();
  } catch (err) {
    status.textContent = `Could not save (${err.message}).`;
  }
}

async function refreshDaily() {
  const meals = await MealsRepo.listForDay(todayStr());
  const totals = dailyTotals(meals);
  const target = parseFloat(document.getElementById('meal-target').value) || 0;
  const cmp = compareToTarget(totals, target);
  const pctStr = cmp.pct === null ? '' : ` (${cmp.pct}% of target, ${cmp.remaining} left)`;
  document.getElementById('meal-daily').textContent =
    `${Math.round(totals.calories)} kcal · P ${Math.round(totals.proteinG)}g · C ${Math.round(totals.carbsG)}g · F ${Math.round(totals.fatG)}g${pctStr}`;
  const list = document.getElementById('meal-list');
  list.innerHTML = '';
  for (const m of meals) {
    const li = document.createElement('li');
    li.className = 'meal-row';
    const label = document.createElement('span');
    label.textContent = `${m.name} — ${Math.round(m.calories || 0)} kcal`;
    if (m.imagePath) {
      const img = document.createElement('img');
      img.className = 'meal-thumb';
      img.alt = '';
      img.loading = 'lazy';
      MealsRepo.signedUrlFor(m.imagePath).then((url) => { if (url) img.src = url; });
      li.appendChild(img);
    }
    li.appendChild(label);
    list.appendChild(li);
  }
}

/* ---------------- Workout tab ---------------- */

async function initWorkoutTab() {
  document.getElementById('workout-date').value = todayStr();
  exercises = await fetch('./data/exercises.json').then((r) => r.json()).catch(() => []);
  const dl = document.getElementById('exercise-list');
  dl.innerHTML = exercises.map((x) => `<option value="${x.name}"></option>`).join('');
  document.getElementById('workout-form').addEventListener('submit', onLogWorkout);
  refreshWeek().catch(() => {});
}

async function onLogWorkout(e) {
  e.preventDefault();
  const status = document.getElementById('workout-status');
  const name = document.getElementById('workout-exercise').value.trim();
  const ex = exercises.find((x) => x.name === name);
  const durationMin = parseFloat(document.getElementById('workout-duration').value) || null;
  const weightKg = parseFloat(document.getElementById('body-weight').value) || 70;
  const caloriesBurned = ex && durationMin
    ? Math.round(estimateBurn({ met: ex.met, weightKg, durationMin }))
    : null;
  try {
    await WorkoutsRepo.save({
      doneAt: document.getElementById('workout-date').value || todayStr(),
      exercise: name,
      category: ex?.category || null,
      sets: parseInt(document.getElementById('workout-sets').value, 10) || null,
      reps: parseInt(document.getElementById('workout-reps').value, 10) || null,
      weightKg: numOrNull(document.getElementById('workout-weight').value),
      durationMin,
      caloriesBurned,
    });
    document.getElementById('workout-form').reset();
    document.getElementById('workout-date').value = todayStr();
    status.textContent = caloriesBurned ? `Logged (~${caloriesBurned} kcal burned).` : 'Logged.';
    refreshWeek();
  } catch (err) {
    status.textContent = `Could not save (${err.message}).`;
  }
}

function weekStart() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return localDateStr(d);
}

async function refreshWeek() {
  const workouts = await WorkoutsRepo.listForWeek(weekStart());
  const totalBurn = workouts.reduce((s, w) => s + (Number(w.caloriesBurned) || 0), 0);
  document.getElementById('workout-summary').textContent =
    `${workouts.length} workouts this week · ~${Math.round(totalBurn)} kcal burned`;
  const list = document.getElementById('workout-list');
  list.innerHTML = '';
  for (const w of workouts) {
    const li = document.createElement('li');
    const setsStr = w.sets ? ` ${w.sets}×${w.reps || ''}` : '';
    const burnStr = w.caloriesBurned ? ` (~${Math.round(w.caloriesBurned)} kcal)` : '';
    li.textContent = `${w.doneAt}: ${w.exercise}${setsStr}${burnStr}`;
    list.appendChild(li);
  }
}

/* ---------------- Sleep tab ---------------- */

function initSleepTab() {
  const dateEl = document.getElementById('sleep-date');
  if (!dateEl) return;
  dateEl.value = todayStr();
  document.getElementById('sleep-save').addEventListener('click', onSaveSleep);
  refreshSleep();
}

/* A time input gives 'HH:MM' with no date. Bed time before ~12:00 is treated
 * as the same morning; anything later is the previous evening — otherwise a
 * 23:00 bedtime and a 07:00 wake on the same date would compute as negative. */
function sleepTimestamps(sleptOn, bedTime, wakeTime) {
  if (!bedTime || !wakeTime) return { bedAt: null, wakeAt: null };
  const [bh] = bedTime.split(':').map(Number);
  const bedDate = new Date(`${sleptOn}T${bedTime}:00`);
  if (bh >= 12) bedDate.setDate(bedDate.getDate() - 1);
  const wakeDate = new Date(`${sleptOn}T${wakeTime}:00`);
  return { bedAt: bedDate.toISOString(), wakeAt: wakeDate.toISOString() };
}

async function onSaveSleep() {
  const status = document.getElementById('sleep-status');
  const sleptOn = document.getElementById('sleep-date').value || todayStr();
  const { bedAt, wakeAt } = sleepTimestamps(
    sleptOn,
    document.getElementById('sleep-bed').value,
    document.getElementById('sleep-wake').value,
  );
  try {
    await SleepRepo.save({
      sleptOn, bedAt, wakeAt,
      durationMin: sleepDurationMin(bedAt, wakeAt),
      quality: numOrNull(document.getElementById('sleep-quality').value),
      note: document.getElementById('sleep-note').value,
    });
    status.textContent = 'Saved.';
    refreshSleep();
  } catch (err) {
    status.textContent = `Could not save (${err.message}).`;
  }
}

async function refreshSleep() {
  const rows = await SleepRepo.listRecent(7);
  const avg = averageDuration(rows);
  document.getElementById('sleep-avg').textContent =
    avg == null ? '' : `7-night average: ${formatDuration(avg)}`;
  const list = document.getElementById('sleep-list');
  list.innerHTML = '';
  for (const r of rows) {
    const li = document.createElement('li');
    li.textContent = `${r.sleptOn} — ${formatDuration(r.durationMin)}${r.quality ? ` · ${r.quality}/5` : ''}`;
    list.appendChild(li);
  }
}
