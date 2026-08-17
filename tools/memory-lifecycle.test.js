import test from 'node:test';
import assert from 'node:assert/strict';
import { frontmatterOf, readStatus, withRetirement } from './memory-lifecycle.mjs';

/* A real entry's shape. The trailing space after `metadata:` is REAL — every one of the 286
 * entries has it — and it is written as \x20 on purpose: a literal trailing space is invisible
 * in a diff and gets stripped by editors and formatters, which would quietly turn the
 * "frontmatter survives verbatim" test below into a test of nothing. The first run of this
 * suite failed exactly that way. Reformatting the frontmatter would rewrite all 286 files. */
const ENTRY = `---
name: ai-chatops-stale-branches
description: "The 6 unmerged branches"
metadata:\x20
  node_type: memory
  type: project
---

**CLEANED UP 2026-08-03: 167 local branches → 7.**

See \`scripts/daily-report.mjs\` for the old shape.
`;

test('an entry with no status field reads as active', () => {
  assert.equal(readStatus(ENTRY), 'active');
});

test('THE property: retiring preserves the body byte-for-byte', () => {
  const out = withRetirement(ENTRY, { at: '2026-08-17', reason: 'broken-reference', evidence: ['scripts/daily-report.mjs — not found in 6 roots'] });
  const bodyOf = (s) => s.slice(s.indexOf('\n---\n', 4) + 5);
  assert.equal(bodyOf(out), bodyOf(ENTRY), 'the body must not be touched');
});

test('THE property: the original frontmatter text survives verbatim', () => {
  const out = withRetirement(ENTRY, { at: '2026-08-17', reason: 'broken-reference', evidence: ['x'] });
  assert.ok(out.includes('metadata: \n'), 'the trailing space after `metadata:` was reformatted');
  assert.ok(out.includes('description: "The 6 unmerged branches"'));
});

test('retirement fields are written and read back', () => {
  const out = withRetirement(ENTRY, { at: '2026-08-17', reason: 'broken-reference', evidence: ['a', 'b'] });
  assert.equal(readStatus(out), 'retired');
  assert.ok(out.includes('retired_at: 2026-08-17'));
  assert.ok(out.includes('retired_reason: broken-reference'));
  assert.ok(out.includes('  a\n  b\n'), 'multi-line evidence must be indented under the block scalar');
});

test('retiring an already-retired entry changes nothing', () => {
  const once = withRetirement(ENTRY, { at: '2026-08-17', reason: 'broken-reference', evidence: ['x'] });
  const twice = withRetirement(once, { at: '2026-08-18', reason: 'broken-reference', evidence: ['y'] });
  assert.equal(twice, once, 're-running the applier must be idempotent');
});

test('an entry with no frontmatter is refused, not rewritten', () => {
  assert.throws(() => withRetirement('no frontmatter here\n', { at: '2026-08-17', reason: 'broken-reference', evidence: [] }), /frontmatter/);
  assert.equal(frontmatterOf('no frontmatter here\n'), null);
});

test('a nested `status:` key inside metadata is not mistaken for the top-level one', () => {
  const tricky = ENTRY.replace('  type: project', '  type: project\n  status: whatever');
  assert.equal(readStatus(tricky), 'active');
});
