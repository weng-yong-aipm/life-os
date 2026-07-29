import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from './coach.js';

const has = (out, sk) => out.some((s) => s.sourceKey === sk);

test('empty snapshot → no suggestions', () => {
  assert.deepEqual(scan({}), []);
  assert.deepEqual(scan(), []);
});

test('feed backlog fires only at >=10 new items', () => {
  const nine = { feed: Array.from({ length: 9 }, () => ({ status: 'new' })) };
  assert.equal(has(scan(nine), 'feed-backlog:feed'), false);
  const ten = { feed: Array.from({ length: 10 }, () => ({ status: 'new' })) };
  assert.equal(has(scan(ten), 'feed-backlog:feed'), true);
  // triaged items don't count
  const mixed = { feed: [...Array.from({ length: 12 }, () => ({ status: 'applied' })), { status: 'new' }] };
  assert.equal(has(scan(mixed), 'feed-backlog:feed'), false);
});

test('applied learning with no matching goal is flagged', () => {
  const snap = {
    learnings: [{ verdict: 'applied', project: 'quantum basket weaving' }],
    goals: [{ title: 'Become an FDE', status: 'active', progress: 10 }],
  };
  assert.equal(has(scan(snap), 'applied-without-goal:learning'), true);
  // matching project → not flagged
  const ok = { learnings: [{ verdict: 'applied', project: 'FDE' }], goals: [{ title: 'Become an FDE', status: 'active', progress: 10 }] };
  assert.equal(has(scan(ok), 'applied-without-goal:learning'), false);
});

test('stalled goal: active + 0% + unfed is flagged; fed or non-zero is not', () => {
  const stalled = { goals: [{ title: 'PMP', status: 'active', progress: 0 }], learnings: [] };
  assert.equal(has(scan(stalled), 'stalled-goal:career'), true);
  const fed = { goals: [{ title: 'PMP', status: 'active', progress: 0 }], learnings: [{ verdict: 'applied', project: 'PMP' }] };
  assert.equal(has(scan(fed), 'stalled-goal:career'), false);
  const moving = { goals: [{ title: 'PMP', status: 'active', progress: 20 }], learnings: [] };
  assert.equal(has(scan(moving), 'stalled-goal:career'), false);
});

test('missing-summary fires at >=5', () => {
  const four = { learnings: Array.from({ length: 4 }, () => ({ summary: '' })) };
  assert.equal(has(scan(four), 'learning-missing-summary:learning'), false);
  const five = { learnings: Array.from({ length: 5 }, () => ({ summary: '  ' })) };
  assert.equal(has(scan(five), 'learning-missing-summary:learning'), true);
});

test('every suggestion has a stable sourceKey and required fields', () => {
  const snap = { feed: Array.from({ length: 11 }, () => ({ status: 'new' })) };
  for (const s of scan(snap)) {
    assert.ok(s.sourceKey && s.title && s.source && s.kind, 'has core fields');
  }
});
