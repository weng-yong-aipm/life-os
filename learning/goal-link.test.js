import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportsGoal, progressSuggestion, linkAppliedToGoals } from './goal-link.js';

test('supportsGoal matches project against goal title or category', () => {
  const goal = { title: 'Become an FDE', category: 'role' };
  assert.equal(supportsGoal({ project: 'FDE' }, goal), true);           // project ⊂ title
  assert.equal(supportsGoal({ project: 'role' }, goal), true);          // project == category
  assert.equal(supportsGoal({ project: 'gardening' }, goal), false);
  assert.equal(supportsGoal({ project: '' }, goal), false);             // empty project never matches
  assert.equal(supportsGoal({}, goal), false);
});

test('progressSuggestion bumps +5 each, caps at +25 and 95', () => {
  assert.equal(progressSuggestion({ progress: 0 }, 0), 0);
  assert.equal(progressSuggestion({ progress: 20 }, 3), 35);            // +15
  assert.equal(progressSuggestion({ progress: 0 }, 100), 25);          // capped at +25
  assert.equal(progressSuggestion({ progress: 90 }, 3), 95);           // capped at 95, not 105
  assert.equal(progressSuggestion({}, 2), 10);                         // missing progress → 0 base
});

test('linkAppliedToGoals only counts APPLIED learnings, one entry per matched goal', () => {
  const goals = [
    { id: 'g1', title: 'FDE', category: 'role', progress: 10 },
    { id: 'g2', title: 'PMP cert', category: 'cert', progress: 0 },
  ];
  const learnings = [
    { verdict: 'applied', project: 'FDE' },
    { verdict: 'applied', project: 'fde' },
    { verdict: 'considering', project: 'FDE' },   // ignored (not applied)
    { verdict: 'rejected', project: 'PMP cert' }, // ignored
  ];
  const links = linkAppliedToGoals(learnings, goals);
  assert.equal(links.length, 1);                  // only FDE matched
  assert.equal(links[0].goal.id, 'g1');
  assert.equal(links[0].count, 2);
  assert.equal(links[0].suggestedProgress, 20);   // 10 + 2*5
});

test('linkAppliedToGoals is safe on empty / missing inputs', () => {
  assert.deepEqual(linkAppliedToGoals(null, null), []);
  assert.deepEqual(linkAppliedToGoals([], [{ id: 'g', title: 'x' }]), []);
});
