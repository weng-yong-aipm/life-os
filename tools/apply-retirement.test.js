import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApproved, moveIndexLine } from './apply-retirement.mjs';

const REPORT = `# Memory rot — nominations 2026-08-17

entries read: 293
references resolved: 790
nominations: 2

- [ ] alpha-entry — scripts/gone.mjs, docs/also-gone.md
- [ ] beta-entry — src/vanished.js

## 路径写短了（不是过时，是写法不精确）

- gamma-entry — src/api.js → /r/cockpit-react/src/api.js
`;

test('parses the approved rows and their evidence', () => {
  assert.deepEqual(parseApproved(REPORT), [
    { name: 'alpha-entry', dead: ['scripts/gone.mjs', 'docs/also-gone.md'] },
    { name: 'beta-entry', dead: ['src/vanished.js'] },
  ]);
});

test('THE property: the 路径写短了 section is never parsed as approvals', () => {
  // Those rows start with `- `, not `- [ ] `. Picking them up would retire entries the report
  // explicitly says are NOT rot.
  assert.ok(!parseApproved(REPORT).some((r) => r.name === 'gamma-entry'), 'a short-path row was read as an approval');
});

test('a row the user deleted is simply absent — deletion IS the rejection', () => {
  const trimmed = REPORT.replace('- [ ] beta-entry — src/vanished.js\n', '');
  assert.deepEqual(parseApproved(trimmed).map((r) => r.name), ['alpha-entry']);
});

const INDEX = `- 👉 **两条:** [A](alpha-entry.md) · [B](beta-entry.md) — 双引用行
- 📦 **[Solo](solo-entry.md)** — 单引用行
`;

test('THE property: a single-entry index line moves under 已淘汰', () => {
  const r = moveIndexLine(INDEX, 'solo-entry');
  assert.equal(r.moved, true);
  assert.match(r.text, /## 已淘汰\n/);
  assert.ok(r.text.indexOf('solo-entry.md') > r.text.indexOf('## 已淘汰'), 'the line must end up below the heading');
  assert.match(r.text, /alpha-entry\.md/, 'other lines are untouched');
});

test('THE property: a line referencing several entries is NOT moved', () => {
  // Moving it would retire beta-entry too, which nobody approved.
  const r = moveIndexLine(INDEX, 'alpha-entry');
  assert.equal(r.moved, false);
  assert.match(r.reason, /2 entries|multiple/i);
  assert.equal(r.text, INDEX, 'the index must be left byte-identical when the move is refused');
});

test('an entry with no index line is reported, not invented', () => {
  const r = moveIndexLine(INDEX, 'not-listed');
  assert.equal(r.moved, false);
  assert.match(r.reason, /no index line/i);
});

test('the 已淘汰 heading is created once, not per retirement', () => {
  const once = moveIndexLine(INDEX, 'solo-entry').text;
  const withSecond = once.replace('- 👉 **两条:**', '- 🧩 **[C](gamma.md)** — x\n- 👉 **两条:**');
  const twice = moveIndexLine(withSecond, 'gamma').text;
  assert.equal(twice.split('## 已淘汰').length - 1, 1);
});

test('a slug that is a prefix of another entry does not match the wrong line', () => {
  // `alpha` must not match `[A](alpha-entry.md)`.
  const r = moveIndexLine(INDEX, 'alpha');
  assert.equal(r.moved, false);
  assert.match(r.reason, /no index line/i);
});

test('THE property: a trailing annotation on a row is not parsed as a dead reference', () => {
  // The scan appends `[索引中]` / `[不在索引]` to nomination rows. The row pattern ends in
  // `(.+)$`, so without stripping it the annotation becomes a fake reference — and lands in the
  // evidence written into the entry, which is the one field a human reads to judge the
  // retirement. Caught by running the real approval file through the real parser before applying.
  const rows = parseApproved('- [ ] e — scripts/a.mjs, scripts/b.mjs  [不在索引]\n');
  assert.deepEqual(rows, [{ name: 'e', dead: ['scripts/a.mjs', 'scripts/b.mjs'] }]);
});

test('a row with no annotation is unaffected', () => {
  assert.deepEqual(parseApproved('- [ ] e — scripts/a.mjs\n'), [{ name: 'e', dead: ['scripts/a.mjs'] }]);
});
