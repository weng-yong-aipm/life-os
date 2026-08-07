import { StrengthRepo } from './strength-repo.js';
import { seedTargets } from './strength.js';
import { localDateStr } from '../shared/local-date.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let exercises = [];
let active = null;

init();

async function init() {
  exercises = await fetch('../health/data/exercises.json').then((r) => r.json()).catch(() => []);
  populateExerciseList();

  document.getElementById('block-start').value = localDateStr();
  document.getElementById('add-session-btn').addEventListener('click', () => addSessionRow());
  document.getElementById('create-block-btn').addEventListener('click', onCreateBlock);
  document.getElementById('end-block-btn').addEventListener('click', onEndBlock);
  document.getElementById('edit-block-btn').addEventListener('click', openEditor);
  document.getElementById('edit-close-btn').addEventListener('click', closeEditor);

  await refresh();
}

function populateExerciseList() {
  const dl = document.getElementById('plan-exercise-list');
  dl.innerHTML = exercises.map((x) => `<option value="${x.name}"></option>`).join('');
}

/* Re-fetches the active block and shows either it or the builder — never
 * both. Mirrors log-ui.js's refresh(): a real error lands in the status
 * line, never a stack trace or a blank page. */
async function refresh() {
  const status = document.getElementById('plan-status');
  try {
    active = await StrengthRepo.getActiveMesocycle();
    status.textContent = '';
  } catch (err) {
    active = null;
    status.textContent = `Training blocks aren't available right now (${err.message}).`;
  }
  render();
}

function render() {
  const activeSection = document.getElementById('plan-active');
  const builder = document.getElementById('plan-builder');

  if (active) {
    activeSection.hidden = false;
    builder.hidden = true;
    document.getElementById('active-name').textContent = active.name;
    document.getElementById('active-goal').textContent =
      active.goal === 'fatloss' ? 'Fat loss' : 'Hypertrophy';
    document.getElementById('active-weeks').textContent = `${active.weeks} weeks`;
    document.getElementById('active-start').textContent = `starts ${active.start_date}`;
    return;
  }

  activeSection.hidden = true;
  builder.hidden = false;
  closeEditor();
}

/* Edit-active-block view (phase 3d): change targets, swap/add/remove an
 * exercise on the running block, scoped to "this session only" or "the
 * rest of the block". See strength-repo.js's swapExercise /
 * replaceExerciseInBlock / updateTargets / addExerciseToSession /
 * removeExerciseFromSession — this is a thin DOM layer over those five. */

function openEditor() {
  document.getElementById('plan-edit').hidden = false;
  renderEditor().catch(() => {});
}

function closeEditor() {
  document.getElementById('plan-edit').hidden = true;
}

async function renderEditor() {
  const status = document.getElementById('edit-status');
  const container = document.getElementById('edit-sessions');
  container.innerHTML = '';
  if (!active) return;

  try {
    const sessions = await StrengthRepo.getUpcomingSessions(active.id);
    status.textContent = '';
    for (const session of sessions) container.appendChild(buildEditSessionCard(session));
  } catch (err) {
    status.textContent = `Could not load block (${err.message}).`;
  }
}

function buildEditSessionCard(session) {
  const card = document.createElement('div');
  card.className = 'session-card';

  const heading = document.createElement('div');
  heading.className = 'edit-session-heading';
  heading.textContent = `${session.date} — ${session.name || 'Session'}`;
  card.appendChild(heading);

  const ul = document.createElement('ul');
  ul.className = 'session-exercises';
  /* Superseded/removed rows (skippedReason set) are history, not something
   * to edit further — they're left out of the editor entirely. */
  for (const ex of session.exercises) {
    if (!ex.skippedReason) ul.appendChild(buildEditExerciseRow(session, ex));
  }
  card.appendChild(ul);

  const addRow = document.createElement('div');
  addRow.className = 'exercise-add';
  const exerciseInput = document.createElement('input');
  exerciseInput.type = 'text';
  exerciseInput.setAttribute('list', 'plan-exercise-list');
  exerciseInput.placeholder = 'add exercise…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ Add exercise';
  addBtn.addEventListener('click', async () => {
    const name = exerciseInput.value.trim();
    if (!name) return;
    const status = document.getElementById('edit-status');
    try {
      await StrengthRepo.addExerciseToSession(session.sessionId, name, seedTargets(active.goal));
      status.textContent = 'Exercise added.';
      await renderEditor();
    } catch (err) {
      status.textContent = `Could not add exercise (${err.message}).`;
    }
  });
  addRow.append(exerciseInput, addBtn);
  card.appendChild(addRow);

  return card;
}

function buildEditExerciseRow(session, ex) {
  const li = document.createElement('li');
  li.className = 'exercise-row edit-exercise-row';

  const name = document.createElement('span');
  name.className = 'exercise-row-name';
  name.textContent = ex.setsLogged > 0 ? `🔒 ${ex.exerciseName}` : ex.exerciseName;
  if (ex.setsLogged > 0) {
    name.title = `${ex.setsLogged} set(s) already logged here — swap/remove keeps them and starts fresh`;
  }

  const sets = numberInput('ex-sets', ex.targetSets, 'sets');
  const repLow = numberInput('ex-rep-low', ex.targetRepLow, 'rep low');
  const repHigh = numberInput('ex-rep-high', ex.targetRepHigh, 'rep high');
  const rir = numberInput('ex-rir', ex.targetRir, 'RIR', 0.5);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save targets';
  saveBtn.addEventListener('click', async () => {
    const status = document.getElementById('edit-status');
    try {
      await StrengthRepo.updateTargets(ex.sessionExerciseId, {
        targetSets: parseInt(sets.value, 10) || null,
        targetRepLow: parseInt(repLow.value, 10) || null,
        targetRepHigh: parseInt(repHigh.value, 10) || null,
        targetRir: parseFloat(rir.value),
      });
      status.textContent = 'Targets saved.';
    } catch (err) {
      status.textContent = `Could not save targets (${err.message}).`;
    }
  });

  const swapInput = document.createElement('input');
  swapInput.type = 'text';
  swapInput.className = 'edit-swap-input';
  swapInput.setAttribute('list', 'plan-exercise-list');
  swapInput.placeholder = 'swap to…';

  const scope = document.createElement('select');
  scope.className = 'edit-swap-scope';
  scope.innerHTML = '<option value="session">this session only</option>'
    + '<option value="block">rest of the block</option>';

  const swapBtn = document.createElement('button');
  swapBtn.type = 'button';
  swapBtn.textContent = 'Swap';
  swapBtn.addEventListener('click', async () => {
    const status = document.getElementById('edit-status');
    const newName = swapInput.value.trim();
    if (!newName) return;
    try {
      if (scope.value === 'block') {
        await StrengthRepo.replaceExerciseInBlock(active.id, ex.exerciseName, newName);
      } else {
        await StrengthRepo.swapExercise(ex.sessionExerciseId, newName);
      }
      status.textContent = 'Exercise swapped.';
      await renderEditor();
    } catch (err) {
      status.textContent = `Could not swap (${err.message}).`;
    }
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-item';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', async () => {
    const status = document.getElementById('edit-status');
    try {
      await StrengthRepo.removeExerciseFromSession(ex.sessionExerciseId);
      status.textContent = 'Exercise removed.';
      await renderEditor();
    } catch (err) {
      status.textContent = `Could not remove (${err.message}).`;
    }
  });

  li.append(name, sets, repLow, repHigh, rir, saveBtn, swapInput, scope, swapBtn, removeBtn);
  return li;
}

function addSessionRow() {
  const list = document.getElementById('session-list');

  const card = document.createElement('div');
  card.className = 'session-card';

  const top = document.createElement('div');
  top.className = 'session-top';

  const daySelect = document.createElement('select');
  daySelect.className = 'session-day';
  for (let d = 0; d < 7; d++) {
    const opt = document.createElement('option');
    opt.value = String(d);
    opt.textContent = DAY_LABELS[d];
    daySelect.appendChild(opt);
  }

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'session-name';
  nameInput.placeholder = 'e.g. Push Day';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-item';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => card.remove());

  top.append(daySelect, nameInput, removeBtn);

  const exerciseList = document.createElement('ul');
  exerciseList.className = 'session-exercises';

  const addRow = document.createElement('div');
  addRow.className = 'exercise-add';
  const exerciseInput = document.createElement('input');
  exerciseInput.type = 'text';
  exerciseInput.setAttribute('list', 'plan-exercise-list');
  exerciseInput.placeholder = 'add exercise…';
  const addExerciseBtn = document.createElement('button');
  addExerciseBtn.type = 'button';
  addExerciseBtn.textContent = '+ Add exercise';
  addExerciseBtn.addEventListener('click', () => {
    const name = exerciseInput.value.trim();
    if (!name) return;
    addExerciseRow(exerciseList, name);
    exerciseInput.value = '';
  });
  addRow.append(exerciseInput, addExerciseBtn);

  card.append(top, exerciseList, addRow);
  list.appendChild(card);
}

function addExerciseRow(ul, exerciseName) {
  const goal = document.getElementById('block-goal').value;
  const target = seedTargets(goal);

  const li = document.createElement('li');
  li.className = 'exercise-row';

  const name = document.createElement('span');
  name.className = 'exercise-row-name';
  name.textContent = exerciseName;

  const sets = numberInput('ex-sets', target.sets, 'sets');
  const repLow = numberInput('ex-rep-low', target.repLow, 'rep low');
  const repHigh = numberInput('ex-rep-high', target.repHigh, 'rep high');
  const rir = numberInput('ex-rir', target.rir, 'RIR', 0.5);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-item';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => li.remove());

  li.append(name, sets, repLow, repHigh, rir, removeBtn);
  ul.appendChild(li);
}

function numberInput(className, value, title, step) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = className;
  input.value = value;
  input.title = title;
  if (step) input.step = String(step);
  return input;
}

/* Reads the builder DOM into a createMesocycle() plan object, same
 * DOM-is-the-state approach as finance.js's receipt-line reader — no
 * parallel JS array kept in sync with what's on screen. */
function gatherPlan() {
  const name = document.getElementById('block-name').value.trim();
  const goal = document.getElementById('block-goal').value;
  const weeks = parseInt(document.getElementById('block-weeks').value, 10);
  const startDate = document.getElementById('block-start').value;

  const sessions = [...document.querySelectorAll('.session-card')].map((card) => ({
    dayOfWeek: Number(card.querySelector('.session-day').value),
    name: card.querySelector('.session-name').value.trim() || 'Session',
    exercises: [...card.querySelectorAll('.exercise-row')].map((row) => ({
      exerciseName: row.querySelector('.exercise-row-name').textContent,
      targetSets: parseInt(row.querySelector('.ex-sets').value, 10) || null,
      targetRepLow: parseInt(row.querySelector('.ex-rep-low').value, 10) || null,
      targetRepHigh: parseInt(row.querySelector('.ex-rep-high').value, 10) || null,
      targetRir: parseFloat(row.querySelector('.ex-rir').value),
    })),
  }));

  return { name, goal, weeks, startDate, sessions };
}

async function onCreateBlock() {
  const status = document.getElementById('plan-status');
  const plan = gatherPlan();

  if (!plan.name) { status.textContent = 'Name the block first.'; return; }
  if (!plan.weeks || plan.weeks < 1) { status.textContent = 'Weeks must be at least 1.'; return; }
  if (!plan.startDate) { status.textContent = 'Pick a start date.'; return; }
  if (!plan.sessions.length) { status.textContent = 'Add at least one session.'; return; }
  if (plan.sessions.some((s) => !s.exercises.length)) {
    status.textContent = 'Every session needs at least one exercise.';
    return;
  }

  try {
    await StrengthRepo.createMesocycle(plan);
    status.textContent = 'Block created.';
    await refresh();
  } catch (err) {
    status.textContent = `Could not create block (${err.message}).`;
  }
}

async function onEndBlock() {
  const status = document.getElementById('plan-status');
  if (!active) return;
  try {
    await StrengthRepo.endMesocycle(active.id);
    status.textContent = 'Block ended.';
    await refresh();
  } catch (err) {
    status.textContent = `Could not end block (${err.message}).`;
  }
}
