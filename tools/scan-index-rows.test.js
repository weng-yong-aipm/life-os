/* 索引行归档这一对的守卫。纯函数，不碰真索引、不碰真归档。
 *   node --test tools/scan-index-rows.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { isRow, linksOf, hasRedLine, judgeRow, assertPlausible, renderReport } from './scan-index-rows.mjs';
import { parseApproved, removeRow, appendToArchive } from './apply-index-archive.mjs';

// 夹具用中性占位：这个仓库是公开的，测试不需要真实条目名也能钉住同样的形状。
const ROW = '- 🎓 [甲](alpha-entry.md) · [乙](beta-entry.md) — ⚠️一句钩子';
const ageAll = (n) => () => n;

test('只有 `- ` 开头的才算索引行；标题和散文不是', () => {
  assert.ok(isRow('- x'));
  assert.ok(!isRow('## 归档'));
  assert.ok(!isRow('MEMORY.md 是热索引'));
});

test('抽出一行里的全部链接', () => {
  assert.deepEqual(linksOf(ROW), ['alpha-entry', 'beta-entry']);
  assert.deepEqual(linksOf('- 没有链接的一行'), []);
});

test('🔴 带红线的行永远不提名 —— 禁令不会因为没人碰而过期', () => {
  const red = '- 🛑 [某条禁令](gamma-entry.md) — 唯一通道是那个脚本';
  assert.ok(hasRedLine(red));
  const v = judgeRow(red, { days: 60, ageOf: ageAll(999) });
  assert.equal(v.nominate, false);
  assert.match(v.reason, /red line/);
});

test('🔴 全部链接都过了静默期才提名 —— 一条还活着就整行不动', () => {
  // 反方向：两条都老 ⇒ 提名
  assert.equal(judgeRow(ROW, { days: 60, ageOf: ageAll(120) }).nominate, true);
  // 正方向：只有一条还新 ⇒ 不提名（部分证据不算数，scan-memory-rot 30→9 那一课）
  const one = (slug) => (slug === 'beta-entry' ? 3 : 120);
  const v = judgeRow(ROW, { days: 60, ageOf: one });
  assert.equal(v.nominate, false);
  assert.match(v.reason, /beta-entry\(3d\)/);
});

test('🔴 链接指向的文件不存在 ⇒ 不提名（那是断引用，是另一个工具的活）', () => {
  const v = judgeRow(ROW, { days: 60, ageOf: (s) => (s === 'alpha-entry' ? null : 120) });
  assert.equal(v.nominate, false);
  assert.match(v.reason, /missing: alpha-entry/);
  // 反方向：把它当成「很老」来提名，会把断引用这个缺陷埋掉
  assert.ok(!/idle|stale/.test(v.reason));
});

test('没有链接的行不提名 —— 它没有可判定的证据', () => {
  assert.equal(judgeRow('- 只是一句话', { days: 60, ageOf: ageAll(999) }).nominate, false);
});

test('🔴 提名超过三成 ⇒ 判成仪器坏了，中止而不是出报告', () => {
  const rows = 10;
  assert.doesNotThrow(() => assertPlausible(new Array(3), rows));
  assert.throws(() => assertPlausible(new Array(4), rows), /instrument fault/);
  // 空索引不许触发除零式的误报
  assert.doesNotThrow(() => assertPlausible([], 0));
});

test('报告把每条的静默天数写出来 —— 人要据此否决', () => {
  const r = renderReport([{ line: ROW, ages: [{ slug: 'a', age: 91 }, { slug: 'b', age: 77 }] }], { days: 60, size: 20000 });
  assert.match(r, /a\(91d\) · b\(77d\)/);
  assert.match(r, /余量 4400/);
  assert.ok(r.includes(ROW), '报告里必须有原文，否则人没法判断');
});

test('🔴 批准面是围栏块：删掉整段就是否决', () => {
  const report = ['## x', '```', ROW, '```', '', '## y', '```', '- 另一行(z.md)', '```'].join('\n');
  assert.deepEqual(parseApproved(report), [ROW, '- 另一行(z.md)']);
  assert.deepEqual(parseApproved('## 只有标题没有围栏'), []);
});

test('🔴 只按**逐字**匹配删行：扫描之后被改写过的行不许被按旧文搬走', () => {
  const idx = ['- a(1.md)', ROW, '- b(2.md)'].join('\n');
  const ok = removeRow(idx, ROW);
  assert.equal(ok.moved, true);
  assert.ok(!ok.text.includes(ROW));
  // 改过一个字就认不出 —— 宁可跳过并报出来
  const rewritten = removeRow(idx, `${ROW}!`);
  assert.equal(rewritten.moved, false);
  assert.match(rewritten.reason, /not found verbatim/);
  assert.equal(rewritten.text, idx, '没搬成却改了索引');
});

test('🔴 同一行出现两次 ⇒ 拒绝猜，两条都留着', () => {
  const dup = [ROW, '- b(2.md)', ROW].join('\n');
  const r = removeRow(dup, ROW);
  assert.equal(r.moved, false);
  assert.match(r.reason, /2×/);
  assert.equal(r.text, dup);
});

test('归档是追加，原文一个字不动，并写明日期', () => {
  const out = appendToArchive('# 归档\n\n旧内容\n', [ROW], '2026-09-23');
  assert.ok(out.startsWith('# 归档\n\n旧内容'), '旧归档内容被动过了');
  assert.ok(out.includes(ROW), '行没进归档');
  assert.match(out, /## 2026-09-23 从热索引移出/);
});
