import { LearningRepo } from './learning-repo.js';
import { MaterialsRepo } from './materials-repo.js';
import { isoWeekKey, summarizeWeek } from './weekly.js';

const todayStr = () => new Date().toISOString().slice(0, 10);
let cache = [];

initTabs();
initLogTab();
initWeeklyTab();

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'weekly') refreshWeekly();
      if (btn.dataset.tab === 'materials') refreshMaterials();
    });
  });
}

/* ---------------- Log tab ---------------- */

function initLogTab() {
  document.getElementById('learn-date').value = todayStr();
  document.getElementById('learn-form').addEventListener('submit', onAddOne);
  document.getElementById('learn-import').addEventListener('click', onImport);
  document.getElementById('learn-filter').addEventListener('change', renderList);
  refresh().catch(() => {});
}

async function refresh() {
  cache = await LearningRepo.list();
  renderList();
}

async function onAddOne(e) {
  e.preventDefault();
  const status = document.getElementById('learn-status');
  const entry = {
    learnedOn: document.getElementById('learn-date').value,
    source: document.getElementById('learn-source').value,
    link: document.getElementById('learn-link').value || null,
    title: document.getElementById('learn-title').value.trim(),
    summary: document.getElementById('learn-summary').value || null,
    project: document.getElementById('learn-project').value || null,
    verdict: document.getElementById('learn-verdict').value,
    appliedNote: document.getElementById('learn-note').value || null,
  };
  try {
    await LearningRepo.add(entry);
    document.getElementById('learn-form').reset();
    document.getElementById('learn-date').value = todayStr();
    status.textContent = 'Added to log.';
    refresh();
  } catch (err) {
    status.textContent = `Could not add (${err.message}).`;
  }
}

async function onImport() {
  const status = document.getElementById('learn-status');
  const raw = document.getElementById('learn-paste').value.trim();
  if (!raw) { status.textContent = 'Paste a JSON array first.'; return; }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    status.textContent = 'That is not valid JSON — check the pasted block.';
    return;
  }
  try {
    const saved = await LearningRepo.add(parsed);
    document.getElementById('learn-paste').value = '';
    status.textContent = `Imported ${saved.length} ${saved.length === 1 ? 'entry' : 'entries'}.`;
    refresh();
  } catch (err) {
    status.textContent = `Could not import (${err.message}).`;
  }
}

const VERDICT_LABEL = { applied: '✓ applied', rejected: '✕ rejected', considering: '· considering' };

function renderList() {
  const filter = document.getElementById('learn-filter').value;
  const rows = filter ? cache.filter((s) => s.verdict === filter) : cache;
  const list = document.getElementById('learn-list');
  list.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.textContent = LearningRepo.cloudEnabled
      ? 'No entries yet — add one or paste a review block.'
      : 'Learning log needs cloud sync — enable Supabase in config.js.';
    list.appendChild(li);
    return;
  }
  for (const s of rows) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = `${s.learnedOn} · ${s.title}${s.project ? ` → ${s.project}` : ''}`;
    const right = document.createElement('span');
    right.textContent = VERDICT_LABEL[s.verdict] || s.verdict;
    li.append(left, right);
    list.appendChild(li);
  }
}

/* ---------------- Weekly tab ---------------- */

function initWeeklyTab() { /* rendered on tab open + first load */ }

async function refreshWeekly() {
  if (!cache.length) cache = await LearningRepo.list().catch(() => []);
  const wk = isoWeekKey(todayStr());
  const s = summarizeWeek(cache.map((x) => x), wk);
  document.getElementById('weekly-head').textContent = `${wk} · ${s.total} ${s.total === 1 ? 'session' : 'sessions'}`;
  document.getElementById('weekly-counts').textContent =
    `${s.byVerdict.applied} applied · ${s.byVerdict.considering} considering · ${s.byVerdict.rejected} rejected`;
  fillList('weekly-projects', Object.entries(s.byProject).map(([p, n]) => `${p} — ${n}`));
  fillList('weekly-applied', s.applied.map((x) => `${x.title}${x.appliedNote ? ` — ${x.appliedNote}` : ''}`));
  fillList('weekly-rejected', s.rejected.map((x) => `${x.title}${x.appliedNote ? ` — ${x.appliedNote}` : ''}`));
}

function fillList(id, items) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    el.appendChild(li);
  }
}

/* ---------------- Materials tab ---------------- */

async function refreshMaterials() {
  const wrap = document.getElementById('materials-list');
  wrap.innerHTML = '';
  let rows;
  try {
    rows = await MaterialsRepo.list();
  } catch (err) {
    wrap.appendChild(hint(`Could not load materials (${err.message}).`));
    return;
  }
  if (!MaterialsRepo.cloudEnabled) { wrap.appendChild(hint('Materials need cloud sync — enable Supabase in config.js.')); return; }
  if (!rows.length) { wrap.appendChild(hint('No materials yet — run `node tools/gen-materials.mjs` to generate some.')); return; }
  for (const m of rows) wrap.appendChild(materialCard(m));
}

function hint(text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

function materialCard(m) {
  const card = document.createElement('details');
  card.className = 'material-card';
  const sum = document.createElement('summary');
  sum.textContent = m.title;
  card.appendChild(sum);

  if (m.guide) {
    const g = document.createElement('p');
    g.className = 'material-guide';
    g.textContent = m.guide;
    card.appendChild(g);
  }

  if (m.flashcards.length) {
    const h = document.createElement('h4');
    h.textContent = 'Flashcards';
    card.appendChild(h);
    for (const f of m.flashcards) {
      const d = document.createElement('details');
      d.className = 'flashcard';
      const s = document.createElement('summary');
      s.textContent = f.front;
      const a = document.createElement('p');
      a.textContent = f.back;
      d.append(s, a);
      card.appendChild(d);
    }
  }

  if (m.quiz.length) {
    const h = document.createElement('h4');
    h.textContent = 'Quiz';
    card.appendChild(h);
    for (const q of m.quiz) {
      const d = document.createElement('details');
      d.className = 'quiz-q';
      const s = document.createElement('summary');
      s.textContent = q.question;
      d.appendChild(s);
      const ul = document.createElement('ul');
      for (const choice of q.choices || []) {
        const li = document.createElement('li');
        li.textContent = choice;
        if (choice === q.answer) li.className = 'correct';
        ul.appendChild(li);
      }
      d.appendChild(ul);
      card.appendChild(d);
    }
  }

  return card;
}
