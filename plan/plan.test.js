import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEEKS, QUARTER_GATES } from './plan-data.js';
import {
  buildIsOutrunningMe,
  currentWeek,
  nextTask,
  overdue,
  ownerSplit,
  progress,
  weekProgress,
} from './plan.js';

const ids = (...xs) => new Set(xs);

test('the plan is 13 consecutive weeks with no gaps or overlaps', () => {
  assert.equal(WEEKS.length, 13);
  assert.equal(WEEKS[0].start, '2026-08-04');
  assert.equal(WEEKS[12].end, '2026-11-02');
  for (let i = 1; i < WEEKS.length; i += 1) {
    const prevEnd = Date.parse(WEEKS[i - 1].end);
    const start = Date.parse(WEEKS[i].start);
    assert.equal((start - prevEnd) / 86400000, 1, `week ${i + 1} does not start the day after week ${i}`);
  }
});

test('every task is well-formed and every week has a gate', () => {
  const seen = new Set();
  for (const w of WEEKS) {
    assert.ok(w.theme && w.gate, `week ${w.week} missing theme or gate`);
    assert.ok(w.tasks.length > 0, `week ${w.week} has no tasks`);
    for (const t of w.tasks) {
      assert.ok(t.id && t.text, `week ${w.week} has a nameless task`);
      assert.ok(['me', 'build'].includes(t.owner), `bad owner: ${t.owner}`);
      assert.equal(typeof t.done, 'boolean');
      assert.ok(!seen.has(t.id), `duplicate task id: ${t.id}`);
      seen.add(t.id);
    }
  }
});

test('nothing in the public plan leaks an employer, a target company or a number to negotiate on', () => {
  const banned = /snsoft|sierra|decagon|scale ai|openai|anthropic|meegle|lark|casino|igaming|palantir|MYR|SGD|RM ?\d|USD ?\d|salary/i;
  const blob = JSON.stringify(WEEKS) + JSON.stringify(QUARTER_GATES);
  const hit = blob.match(banned);
  assert.equal(hit, null, `public plan leaks: ${hit && hit[0]}`);
});

test('currentWeek finds the containing week and clamps outside the plan', () => {
  assert.equal(currentWeek('2026-08-05').week, 1);
  assert.equal(currentWeek('2026-08-17').week, 2);
  assert.equal(currentWeek('2026-11-02').week, 13);
  assert.equal(currentWeek('2026-01-01').week, 1, 'before the plan should clamp to W1');
  assert.equal(currentWeek('2027-06-01').week, 13, 'after the plan should clamp to W13');
});

test('progress counts across the whole plan', () => {
  const empty = progress(ids());
  assert.equal(empty.done, 0);
  assert.equal(empty.pct, 0);
  assert.ok(empty.total > 30);

  const some = progress(ids('w1-artifact', 'w1-readme'));
  assert.equal(some.done, 2);
});

test('weekProgress is per-week, not global', () => {
  const w1 = WEEKS[0];
  const p = weekProgress(w1, ids('w1-artifact'));
  assert.equal(p.done, 1);
  assert.equal(p.total, w1.tasks.length);
});

test('overdue only reports tasks from weeks that have already ended', () => {
  const late = overdue('2026-08-20', ids());
  assert.ok(late.every((t) => t.end < '2026-08-20'));
  assert.ok(late.some((t) => t.week === 1), 'week 1 tasks should be overdue by 2026-08-20');
  assert.ok(!late.some((t) => t.week === 3), 'week 3 has not ended yet');

  const none = overdue('2026-08-05', ids());
  assert.equal(none.length, 0, 'nothing is overdue in week 1');
});

test('ownerSplit separates work needing a person from work needing a desk', () => {
  const s = ownerSplit(ids());
  assert.ok(s.me.total > 0 && s.build.total > 0);
  assert.equal(s.me.done + s.build.done, 0);
});

test('buildIsOutrunningMe fires when engineering races ahead of the human work', () => {
  const buildIds = WEEKS.flatMap((w) => w.tasks).filter((t) => t.owner === 'build').map((t) => t.id);
  assert.equal(buildIsOutrunningMe(ids(...buildIds)), true, 'all build done, no me done → should fire');
  assert.equal(buildIsOutrunningMe(ids()), false, 'nothing done → nobody is ahead');
});

test('shipping anything while having asked nobody anything fires it immediately', () => {
  // The real state on 2026-08-05: four build tasks done, zero person tasks done.
  assert.equal(buildIsOutrunningMe(ids('w1-artifact')), true,
    'one thing built and nobody asked is the failure mode, regardless of percentages');
});

test('it stops firing once the human work is moving', () => {
  const some = ids('w1-artifact', 'w1-readme', 'w1-stats', 'w9-sec',
    'w1-ask', 'w1-linkedin', 'w1-outreach', 'w2-targets', 'w2-outreach', 'w2-answer');
  assert.equal(buildIsOutrunningMe(some), false, 'person work caught up → no warning');
});

test('nextTask scans forward from the current week and returns null when finished', () => {
  const t = nextTask('2026-08-05', ids());
  assert.equal(t.week, 1);
  assert.equal(t.id, 'w1-artifact');

  const afterFirst = nextTask('2026-08-05', ids('w1-artifact', 'w1-readme', 'w1-stats'));
  assert.equal(afterFirst.id, 'w1-ask');

  const all = new Set(WEEKS.flatMap((w) => w.tasks).map((t2) => t2.id));
  assert.equal(nextTask('2026-08-05', all), null);
});

test('the quarter gates are outcome-shaped, not effort-shaped', () => {
  assert.equal(QUARTER_GATES.length, 5);
  assert.ok(!QUARTER_GATES.some((g) => /offer|salary|hired/i.test(g)),
    'an offer inside 90 days is not a gate the plan controls');
});
