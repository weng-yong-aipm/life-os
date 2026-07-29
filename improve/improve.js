// Improve module — the improvements inbox UI (self-improvement engine, Phase 3).
// Lists suggestions and lets you approve / mark-applied / dismiss. "Scan now" runs
// the rules-only Coach against your live modules and files fresh suggestions
// (idempotent — re-scanning won't duplicate open ones).
import { ImproveRepo } from './improve-repo.js';
import { FeedRepo } from '../feed/feed-repo.js';
import { LearningRepo } from '../learning/learning-repo.js';
import { GoalsRepo } from '../career/goals-repo.js';
import { scan } from './coach.js';

const $ = (id) => document.getElementById(id);
const setStatus = (m) => { const el = $('improve-status'); if (el) el.textContent = m; };

function rowEl(r) {
  const li = document.createElement('li');
  const done = r.status === 'applied' || r.status === 'dismissed';
  if (done) li.style.opacity = '0.55';

  const head = document.createElement('div');
  head.textContent = `[${r.kind}] ${r.title}`;
  li.appendChild(head);

  if (r.detail) {
    const d = document.createElement('div');
    d.textContent = r.detail;
    d.style.fontSize = '0.85em';
    li.appendChild(d);
  }

  if (done) {
    const tag = document.createElement('em');
    tag.textContent = ` — ${r.status}`;
    li.appendChild(tag);
    return li;
  }

  const bar = document.createElement('div');
  for (const [label, st] of [['Approve', 'approved'], ['Mark applied', 'applied'], ['Dismiss', 'dismissed']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await ImproveRepo.setStatus(r.id, st); await render(); }
      catch { b.disabled = false; setStatus('Sign in to sync.'); }
    });
    bar.append(b, ' ');
  }
  li.appendChild(bar);
  return li;
}

async function render() {
  const list = $('improve-list');
  if (!list) return;
  let rows;
  try { rows = await ImproveRepo.list(); }
  catch { list.innerHTML = '<li>Sign in to see your improvement inbox.</li>'; return; }
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li>No suggestions yet — hit “Scan now”.</li>'; return; }
  const order = { proposed: 0, approved: 1, applied: 2, dismissed: 3 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  for (const r of rows) list.appendChild(rowEl(r));
}

async function runScan() {
  setStatus('Scanning…');
  try {
    const [feed, learnings, goals] = await Promise.all([FeedRepo.list(), LearningRepo.list(), GoalsRepo.list()]);
    const suggestions = scan({ feed, learnings, goals });
    if (!suggestions.length) { setStatus('Scan complete — nothing to suggest right now. 🎉'); await render(); return; }
    const { saved } = await ImproveRepo.upsert(suggestions);
    setStatus(`Scan complete — ${suggestions.length} suggestion(s), ${saved} new.`);
    await render();
  } catch {
    setStatus('Scan needs cloud sync — sign in first.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = $('improve-scan');
  if (btn) btn.addEventListener('click', runScan);
  render();
});
