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
