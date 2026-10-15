import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMilestones, planSync } from './goal-sync.mjs';

const doc = (rows) => `# Plan\n\nprose\n\n## Milestones (machine)\n\n| id | title | due | status | next_step |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n## Later\n| not | a | milestone | table | x |\n`;

test('parses the machine table and stops at the next heading', () => {
  const r = parseMilestones(doc(['| m1 | One | 2026-11-01 | doing | do it |', '| m2 | Two | 2026-12-01 | done |  |']));
  assert.deepEqual(r, [
    { id: 'm1', title: 'One', due: '2026-11-01', status: 'doing', next_step: 'do it' },
    { id: 'm2', title: 'Two', due: '2026-12-01', status: 'done', next_step: '' },
  ]);
});

test('missing section fails loudly', () => {
  assert.throws(() => parseMilestones('# Plan\nno table'), /Milestones \(machine\)/);
});

test('every malformed row names its line', () => {
  const bad = [
    ['| m1 | One | 2026-13-01 | doing | x |', /line 9: .*due/],
    ['| m1 | One | 2026-11-01 | started | x |', /line 9: .*status/],
    ['| m1 | One | 2026-11-01 | doing |  |', /line 9: .*next_step/],
    ['| m 1 | One | 2026-11-01 | doing | x |', /line 9: .*id/],
    ['| m1 | One | 2026-11-01 | doing |', /line 9: .*5 columns/],
  ];
  for (const [row, re] of bad) assert.throws(() => parseMilestones(doc([row])), re);
});

test('duplicate ids fail', () => {
  assert.throws(() => parseMilestones(doc(['| m1 | A | 2026-11-01 | todo | x |', '| m1 | B | 2026-11-02 | todo | y |'])), /line 10: duplicate id m1/);
});

test('an empty table fails rather than dropping everything', () => {
  assert.throws(() => parseMilestones(doc([])), /no milestone rows/);
});

test('a wrong header fails', () => {
  const md = '## Milestones (machine)\n\n| id | name | due | status | next_step |\n|---|---|---|---|---|\n| m1 | A | 2026-11-01 | todo | x |\n';
  assert.throws(() => parseMilestones(md), /line 3: header/);
});

test('planSync drops ids that left the file, but never re-drops', () => {
  const rows = [{ id: 'm1' }];
  const existing = [{ id: 'm1', status: 'doing' }, { id: 'm2', status: 'todo' }, { id: 'm3', status: 'dropped' }];
  assert.deepEqual(planSync(existing, rows), { upserts: rows, dropIds: ['m2'] });
});
