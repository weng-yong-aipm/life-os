/* Plan UI. State is a set of completed task ids in localStorage — no account needed,
 * works in demo mode, and a 13-week checklist does not warrant a table. DOM is built
 * with createElement/textContent, matching the rest of the repo. */

import { QUARTER_GATES, WEEKS } from './plan-data.js';
import {
  buildIsOutrunningMe,
  currentWeek,
  nextTask,
  overdue,
  ownerSplit,
  progress,
  weekProgress,
} from './plan.js';

const KEY = 'lifeos.plan.done';
const today = new Date().toISOString().slice(0, 10);

function load() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function save(done) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    /* private browsing — the checklist still works for this session */
  }
}

/* Tasks marked done in the data file are pre-checked on first load, so the plan opens
 * reflecting what has actually shipped rather than an empty slate. */
function seed(done) {
  if (localStorage.getItem(KEY) !== null) return done;
  WEEKS.flatMap((w) => w.tasks).filter((t) => t.done).forEach((t) => done.add(t.id));
  save(done);
  return done;
}

let done = seed(load());

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function renderOverview() {
  const wrap = document.getElementById('plan-overview');
  wrap.replaceChildren();
  const p = progress(done);
  const s = ownerSplit(done);
  const cur = currentWeek(today);
  const next = nextTask(today, done);

  wrap.appendChild(el('p', 'plan-headline',
    `Week ${cur.week} of 13 · ${cur.theme} · ${p.done}/${p.total} tasks done (${p.pct}%)`));

  const split = el('p', 'hint',
    `Needs a person: ${s.me.done}/${s.me.total} (${s.me.pct}%) · Can be built: ${s.build.done}/${s.build.total} (${s.build.pct}%)`);
  wrap.appendChild(split);

  if (buildIsOutrunningMe(done)) {
    wrap.appendChild(el('p', 'plan-warn',
      'Engineering is running well ahead of the work that needs a person. That is the documented failure mode: artefacts nobody has asked for yet. Do a "needs a person" task next.'));
  }

  if (next) {
    wrap.appendChild(el('p', 'plan-next', `Next: ${next.text} (W${next.week})`));
  } else {
    wrap.appendChild(el('p', 'plan-next', 'Everything is done. Write the scoreboard.'));
  }

  const late = overdue(today, done);
  if (late.length) {
    const d = el('details', 'plan-overdue');
    d.appendChild(el('summary', null, `${late.length} overdue`));
    const ul = el('ul');
    late.forEach((t) => ul.appendChild(el('li', null, `W${t.week} · ${t.text}`)));
    d.appendChild(ul);
    wrap.appendChild(d);
  }
}

function taskRow(task) {
  const li = el('li', `plan-task owner-${task.owner}`);
  const label = el('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = done.has(task.id);
  box.addEventListener('change', () => {
    if (box.checked) done.add(task.id);
    else done.delete(task.id);
    save(done);
    render();
  });
  const tag = el('span', 'plan-owner', task.owner === 'me' ? 'you' : 'build');
  label.append(box, tag, el('span', 'plan-text', task.text));
  li.appendChild(label);
  return li;
}

function weekCard(w) {
  const card = el('section', 'plan-week');
  const wp = weekProgress(w, done);
  const isNow = currentWeek(today).week === w.week;
  if (isNow) card.classList.add('is-current');
  if (wp.pct === 100) card.classList.add('is-done');

  const head = el('header', 'plan-week-head');
  head.appendChild(el('h3', null, `W${w.week} · ${w.theme}`));
  head.appendChild(el('span', 'plan-dates', `${w.start} → ${w.end} · ${wp.done}/${wp.total}`));
  card.appendChild(head);

  card.appendChild(el('p', 'plan-gate', `Gate: ${w.gate}`));

  const ul = el('ul', 'plan-tasks');
  w.tasks.forEach((t) => ul.appendChild(taskRow(t)));
  card.appendChild(ul);
  return card;
}

function renderWeeks() {
  const wrap = document.getElementById('plan-weeks');
  wrap.replaceChildren();
  const filter = document.getElementById('plan-filter').value;
  WEEKS.filter((w) => {
    if (filter === 'current') return w.week === currentWeek(today).week;
    if (filter === 'open') return w.tasks.some((t) => !done.has(t.id));
    return true;
  }).forEach((w) => wrap.appendChild(weekCard(w)));
}

function renderGates() {
  const ul = document.getElementById('plan-gates');
  ul.replaceChildren();
  QUARTER_GATES.forEach((g) => ul.appendChild(el('li', null, g)));
}

function render() {
  renderOverview();
  renderWeeks();
}

document.getElementById('plan-filter').addEventListener('change', renderWeeks);
document.getElementById('plan-reset').addEventListener('click', () => {
  if (!confirm('Clear every tick and start the plan from scratch?')) return;
  localStorage.removeItem(KEY);
  done = seed(new Set());
  render();
});

renderGates();
render();
