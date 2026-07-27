import { GoalsRepo } from './goals-repo.js';
import { summarize, FDE_STARTER, MILESTONE_TRACK, STATUSES } from './goals.js';

let cache = [];

initForm();
document.getElementById('goal-seed').addEventListener('click', () => onSeed(FDE_STARTER, 'FDE track'));
document.getElementById('goal-seed-ladder').addEventListener('click', () => onSeed(MILESTONE_TRACK, 'career ladder'));
document.getElementById('goal-filter').addEventListener('change', render);
refresh().catch(() => {});

function initForm() {
  document.getElementById('goal-form').addEventListener('submit', onAdd);
}

async function refresh() {
  cache = await GoalsRepo.list();
  render();
}

async function onAdd(e) {
  e.preventDefault();
  const msg = document.getElementById('goal-status-msg');
  const goal = {
    title: document.getElementById('goal-title').value.trim(),
    category: document.getElementById('goal-category').value,
    status: document.getElementById('goal-status').value,
    progress: document.getElementById('goal-progress').value,
    targetDate: document.getElementById('goal-target').value || null,
    note: document.getElementById('goal-note').value || null,
  };
  try {
    await GoalsRepo.add(goal);
    e.target.reset();
    document.getElementById('goal-progress').value = 0;
    msg.textContent = 'Goal added.';
    refresh();
  } catch (err) {
    msg.textContent = `Could not add (${err.message}).`;
  }
}

async function onSeed(seedSet, label) {
  const msg = document.getElementById('goal-status-msg');
  const existing = new Set(cache.map((g) => g.title));
  const fresh = seedSet.filter((g) => !existing.has(g.title));
  if (!fresh.length) { msg.textContent = `${label} already seeded.`; return; }
  try {
    await GoalsRepo.add(fresh);
    msg.textContent = `Seeded ${fresh.length} from ${label}.`;
    refresh();
  } catch (err) {
    msg.textContent = `Could not seed (${err.message}).`;
  }
}

const CAT_LABEL = { role: 'Role', income: 'Income', cert: 'Cert', course: 'Course', skill: 'Skill' };

function renderOverview() {
  const el = document.getElementById('goals-overview');
  if (!GoalsRepo.cloudEnabled) { el.textContent = 'Goals need cloud sync — enable Supabase in config.js.'; return; }
  if (!cache.length) { el.textContent = 'No goals yet — add one or seed the FDE track.'; return; }
  const s = summarize(cache);
  const certs = s.byCategory.cert || { total: 0, done: 0 };
  el.textContent =
    `${s.overallProgress}% overall · ${s.byStatus.active} active · ${s.byStatus.done} done · ` +
    `${certs.done}/${certs.total} certs earned`;
}

function render() {
  renderOverview();
  const filter = document.getElementById('goal-filter').value;
  const rows = filter ? cache.filter((g) => g.category === filter) : cache;
  const wrap = document.getElementById('goal-list');
  wrap.innerHTML = '';
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = cache.length ? 'None in this filter.' : 'Nothing tracked yet.';
    wrap.appendChild(p);
    return;
  }
  for (const g of rows) wrap.appendChild(goalCard(g));
}

function goalCard(g) {
  const card = document.createElement('div');
  card.className = 'goal-card';

  const top = document.createElement('div');
  top.className = 'goal-top';
  const title = document.createElement('span');
  title.className = 'goal-title';
  title.textContent = g.title;
  const chip = document.createElement('span');
  chip.className = `chip cat-${g.category}`;
  chip.textContent = CAT_LABEL[g.category] || g.category;
  top.append(title, chip);

  const bar = document.createElement('div');
  bar.className = 'goal-bar';
  const fill = document.createElement('div');
  fill.className = 'goal-fill';
  fill.style.width = `${g.progress}%`;
  bar.appendChild(fill);

  const meta = document.createElement('div');
  meta.className = 'goal-meta';
  const pct = document.createElement('span');
  pct.textContent = `${g.progress}%`;
  if (g.targetDate) {
    const due = document.createElement('span');
    due.textContent = `due ${g.targetDate}`;
    meta.append(pct, due);
  } else {
    meta.append(pct);
  }

  const actions = document.createElement('div');
  actions.className = 'goal-actions';
  const sel = document.createElement('select');
  for (const st of STATUSES) {
    const opt = document.createElement('option');
    opt.value = st;
    opt.textContent = st;
    if (st === g.status) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', async () => {
    const patch = { status: sel.value };
    if (sel.value === 'done') patch.progress = 100;
    try { await GoalsRepo.update(g.id, patch); refresh(); } catch (err) { alert(err.message); }
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'link-btn';
  del.textContent = 'Remove';
  del.addEventListener('click', async () => {
    if (!confirm(`Remove "${g.title}"?`)) return;
    try { await GoalsRepo.remove(g.id); refresh(); } catch (err) { alert(err.message); }
  });
  actions.append(sel, del);

  if (g.note) {
    const note = document.createElement('p');
    note.className = 'goal-note';
    note.textContent = g.note;
    card.append(top, bar, meta, actions, note);
  } else {
    card.append(top, bar, meta, actions);
  }
  return card;
}
