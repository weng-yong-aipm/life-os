// Self-injecting UI for the Learning → Goals link. Adds an "Applied learnings →
// goals they support" panel to the Weekly tab, with a one-click "advance goal"
// action. Kept as its own file (only a <script> line added to index.html) so it
// doesn't collide with the concurrent knowledge-platform work on learning.js.
import { LearningRepo } from './learning-repo.js';
import { GoalsRepo } from '../career/goals-repo.js';
import { linkAppliedToGoals } from './goal-link.js';

async function render() {
  const host = document.getElementById('tab-weekly');
  if (!host) return;
  let panel = document.getElementById('goal-link-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'goal-link-panel';
    panel.innerHTML = '<h3>Applied learnings → goals</h3><ul id="goal-link-list"></ul>';
    host.appendChild(panel);
  }
  const list = panel.querySelector('#goal-link-list');
  const [learnings, goals] = await Promise.all([LearningRepo.list(), GoalsRepo.list()]);
  const links = linkAppliedToGoals(learnings, goals);
  list.innerHTML = '';
  if (!links.length) {
    list.innerHTML =
      '<li>No applied learnings map to a goal yet — set a learning’s “Applies to project” to a goal name.</li>';
    return;
  }
  for (const { goal, count, suggestedProgress } of links) {
    const li = document.createElement('li');
    const cur = Number(goal.progress) || 0;
    li.textContent = `${goal.title} — ${count} applied · ${cur}%`;
    if (suggestedProgress > cur) {
      const btn = document.createElement('button');
      btn.textContent = `advance → ${suggestedProgress}%`;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await GoalsRepo.update(goal.id, { progress: suggestedProgress });
          btn.textContent = '✓ advanced';
        } catch {
          btn.textContent = 'sign in to sync';
          btn.disabled = false;
        }
      });
      li.append(' ', btn);
    }
    list.appendChild(li);
  }
}

document.addEventListener('DOMContentLoaded', render);
