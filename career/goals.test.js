import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, clampProgress, AI_PM_RUBRIC, NINETY_DAY_TRACK, CATEGORIES, STATUSES } from './goals.js';

test('all seed sets are well-formed with valid categories/statuses', () => {
  for (const [name, set] of [['AI_PM_RUBRIC', AI_PM_RUBRIC], ['NINETY_DAY_TRACK', NINETY_DAY_TRACK]]) {
    assert.ok(set.length >= 4, `${name} too small`);
    for (const g of set) {
      assert.ok(CATEGORIES.includes(g.category), `${name}: bad category ${g.category}`);
      assert.ok(STATUSES.includes(g.status), `${name}: bad status ${g.status}`);
      assert.equal(clampProgress(g.progress), g.progress, `${name}: unclamped progress`);
    }
  }
  // the AI-PM rubric carries all 5 capabilities
  assert.equal(AI_PM_RUBRIC.length, 5);
  assert.match(AI_PM_RUBRIC.map((g) => g.title).join(' | '), /requirement decomposition/);
});

test('clampProgress rounds and bounds to 0..100', () => {
  assert.equal(clampProgress(-5), 0);
  assert.equal(clampProgress(150), 100);
  assert.equal(clampProgress(42.6), 43);
  assert.equal(clampProgress('abc'), 0);
});

test('summarize rolls up status, category, and mean progress', () => {
  const goals = [
    { title: 'FDE', category: 'role', status: 'active', progress: 20 },
    { title: 'PMP', category: 'cert', status: 'done', progress: 100 },
    { title: 'Scrum', category: 'cert', status: 'planned', progress: 0 },
    { title: 'RAG', category: 'skill', status: 'active', progress: 60 },
  ];
  const r = summarize(goals);
  assert.equal(r.total, 4);
  assert.deepEqual(r.byStatus, { planned: 1, active: 2, done: 1 });
  assert.deepEqual(r.byCategory.cert, { total: 2, done: 1 });
  assert.deepEqual(r.byCategory.role, { total: 1, done: 0 });
  assert.equal(r.overallProgress, 45); // (20+100+0+60)/4
});

test('summarize handles empty and unknown values safely', () => {
  assert.deepEqual(summarize([]), {
    total: 0, byStatus: { planned: 0, active: 0, done: 0 }, byCategory: {}, overallProgress: 0,
  });
  const r = summarize([{ title: 'x', category: 'bogus', status: 'bogus', progress: 10 }]);
  assert.equal(r.byStatus.planned, 1); // unknown status -> planned
  assert.equal(r.byCategory.skill.total, 1); // unknown category -> skill
});


test('NINETY_DAY_TRACK has one row per week for 13 weeks', () => {
  assert.equal(NINETY_DAY_TRACK.length, 13);
  const dates = NINETY_DAY_TRACK.map((g) => g.targetDate);
  assert.equal(new Set(dates).size, 13, 'duplicate target dates');
  assert.equal(dates[0], '2026-08-10');
  assert.equal(dates[12], '2026-11-02');
  // dates must be strictly increasing, exactly 7 days apart
  for (let i = 1; i < dates.length; i += 1) {
    const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000;
    assert.equal(gap, 7, `week ${i + 1} is ${gap} days after week ${i}`);
  }
});

test('NINETY_DAY_TRACK leaks no employer or target-company names', () => {
  const banned = /snsoft|sierra|decagon|scale ai|openai|anthropic|meegle|lark|casino|igaming|palantir/i;
  for (const g of NINETY_DAY_TRACK) {
    assert.ok(!banned.test(g.title), `title leaks: ${g.title}`);
    assert.ok(!banned.test(g.note || ''), `note leaks: ${g.title}`);
  }
});

test('NINETY_DAY_TRACK rows are valid goal shapes', () => {
  for (const g of NINETY_DAY_TRACK) {
    assert.ok(g.title && typeof g.title === 'string');
    assert.ok(CATEGORIES.includes(g.category), `bad category: ${g.category}`);
    assert.equal(g.status, 'planned');
    assert.equal(g.progress, 0);
    assert.ok(g.note && g.note.length > 20, `note too thin: ${g.title}`);
  }
});

