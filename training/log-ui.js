import { StrengthRepo } from './strength-repo.js';
import { SUPABASE_URL } from '../config.js';
import { mediaFor } from './catalogue.js';

let exercises = [];
let media = [];
/* Ephemeral only — the last SetSuggestion the repo handed back, held in the
 * UI so the numbers on screen don't flicker between actions. Lost on
 * refresh, which is fine: getCurrentSet() re-derives it from scratch. */
let current = null;

init();

async function init() {
  [exercises, media] = await Promise.all([
    fetch('../health/data/exercises.json').then((r) => r.json()).catch(() => []),
    fetch('../health/data/exercise-media.json').then((r) => r.json()).catch(() => []),
  ]);

  document.getElementById('log-btn').addEventListener('click', onLog);
  document.getElementById('log-skip-btn').addEventListener('click', onSkip);
  document.getElementById('log-undo-btn').addEventListener('click', onUndo);
  document.getElementById('log-finish-btn').addEventListener('click', onFinish);

  await refresh();
}

/* Re-fetches the current set and the plan list, then re-renders both. Every
 * action below ends by calling this rather than patching the DOM by hand —
 * position is derived, so the screen should be too. */
async function refresh() {
  const status = document.getElementById('log-status');
  try {
    current = await StrengthRepo.getCurrentSet();
    status.textContent = '';
  } catch (err) {
    /* Never a stack trace, never a blank page: missing config, missing
     * sign-in, or (pre-migration) missing tables all land here. */
    current = null;
    status.textContent = `Training log isn't available right now (${err.message}).`;
  }
  render();
  renderPlan().catch(() => {});
}

function render() {
  const card = document.getElementById('log-card');
  const empty = document.getElementById('log-empty');
  const complete = document.getElementById('log-complete');
  card.hidden = true;
  empty.hidden = true;
  complete.hidden = true;
  if (!current) return;

  if (current.sessionComplete) {
    complete.hidden = false;
    return;
  }
  if (current.empty) {
    empty.hidden = false;
    return;
  }

  card.hidden = false;
  document.getElementById('log-exercise-name').textContent = current.exerciseName;
  renderMedia(current.exerciseName);
  document.getElementById('log-set-counter').textContent =
    `Set ${current.setNumber} / ${current.targetSets ?? '?'}`;
  document.getElementById('log-rir').textContent = current.rir != null ? `RIR ${current.rir}` : '';
  document.getElementById('log-weight').value = current.weightKg ?? '';
  document.getElementById('log-reps').value = current.reps ?? '';
  document.getElementById('log-last-time').textContent = current.lastTime
    ? `last time: ${current.lastTime.weightKg ?? '?'} kg × ${current.lastTime.reps ?? '?'}`
    : 'last time: no history yet';
}

/* The no-image state (~60% of exercises) is a deliberate composition —
 * instructions plus one outbound link — not a hole where a picture should
 * be. Same pattern as catalogue-ui.js's buildNoImageBlock. */
function renderMedia(name) {
  const wrap = document.getElementById('log-media');
  wrap.innerHTML = '';
  const record = mediaFor(media, name);

  if (record) {
    wrap.className = '';
    const img = document.createElement('img');
    img.src = `${SUPABASE_URL}/storage/v1/object/public/exercise-media/${record.path}`;
    img.alt = name;
    img.loading = 'lazy';
    wrap.appendChild(img);
    return;
  }

  wrap.className = 'log-media-empty';
  const ex = exercises.find((e) => e.name === name);
  const p = document.createElement('p');
  p.className = 'log-no-media-text';
  p.textContent = ex && Array.isArray(ex.instructions) && ex.instructions.length
    ? ex.instructions.join(' ')
    : 'No demo image on file.';
  wrap.appendChild(p);

  const link = document.createElement('a');
  link.className = 'log-demo-link';
  link.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise form`)}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Watch a demo →';
  wrap.appendChild(link);
}

async function renderPlan() {
  const ul = document.getElementById('log-plan-list');
  const plan = await StrengthRepo.getSessionPlan();
  ul.innerHTML = '';
  for (const item of plan) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plan-item' + (current && current.sessionExerciseId === item.sessionExerciseId ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = item.exerciseName;
    const count = document.createElement('span');
    count.className = 'plan-count';
    count.textContent = `${item.setsLogged} / ${item.targetSets ?? '?'}`;
    btn.append(name, count);
    btn.addEventListener('click', () => onJump(item.sessionExerciseId));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function numOrUndefined(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function onLog() {
  const status = document.getElementById('log-status');
  const overrides = {};
  const weightKg = numOrUndefined(document.getElementById('log-weight').value);
  const reps = numOrUndefined(document.getElementById('log-reps').value);
  if (weightKg !== undefined) overrides.weightKg = weightKg;
  if (reps !== undefined) overrides.reps = reps;

  try {
    const { next } = await StrengthRepo.logSet(overrides);
    current = next;
    status.textContent = '';
    render();
    renderPlan().catch(() => {});
  } catch (err) {
    status.textContent = `Could not log set (${err.message}).`;
  }
}

async function onSkip() {
  const status = document.getElementById('log-status');
  try {
    current = await StrengthRepo.skipExercise();
    status.textContent = '';
    render();
    renderPlan().catch(() => {});
  } catch (err) {
    status.textContent = `Could not skip (${err.message}).`;
  }
}

async function onUndo() {
  const status = document.getElementById('log-status');
  try {
    await StrengthRepo.undoLastSet();
    current = await StrengthRepo.getCurrentSet();
    status.textContent = 'Last set undone.';
    render();
    renderPlan().catch(() => {});
  } catch (err) {
    status.textContent = `Could not undo (${err.message}).`;
  }
}

async function onFinish() {
  const status = document.getElementById('log-status');
  try {
    await StrengthRepo.finishWorkout();
    status.textContent = 'Workout saved.';
  } catch (err) {
    status.textContent = `Could not finish (${err.message}).`;
  }
}

async function onJump(sessionExerciseId) {
  const status = document.getElementById('log-status');
  try {
    current = await StrengthRepo.jumpToExercise(sessionExerciseId);
    status.textContent = '';
    render();
    renderPlan().catch(() => {});
  } catch (err) {
    status.textContent = `Could not switch exercise (${err.message}).`;
  }
}
