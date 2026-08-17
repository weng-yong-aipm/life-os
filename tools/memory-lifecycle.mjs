#!/usr/bin/env node
/* The only code that reads or writes lifecycle frontmatter on a memory entry.
 *
 * Text insertion, never a YAML round-trip. Entry frontmatter carries a trailing
 * space after `metadata: ` and nested keys; parsing and re-serialising would
 * reformat all 286 entries, turning a one-field change into a whole-corpus diff.
 * So the original frontmatter text is preserved verbatim and the new fields are
 * appended just before the closing `---`.
 *
 * Absent `status` means active. That is what makes this additive: 286 existing
 * entries need no migration and behave exactly as they do now.
 */

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

export function frontmatterOf(src) {
  const m = FM.exec(src);
  return m ? { raw: m[1], length: m[0].length } : null;
}

/* `^status:` with no leading whitespace — a `status:` nested under `metadata:`
 * is indented and must not be read as the entry's lifecycle state. */
export function readStatus(src) {
  const fm = frontmatterOf(src);
  if (!fm) return 'active';
  const m = /^status:[ \t]*(\S+)/m.exec(fm.raw);
  return m && m[1] === 'retired' ? 'retired' : 'active';
}

export function withRetirement(src, { at, reason, evidence = [] }) {
  const m = FM.exec(src);
  if (!m) throw new Error('memory-lifecycle: entry has no frontmatter — refusing to write');
  if (readStatus(src) === 'retired') return src;
  const block = [
    'status: retired',
    `retired_at: ${at}`,
    `retired_reason: ${reason}`,
    'retired_evidence: |',
    ...evidence.map((line) => `  ${line}`),
  ].join('\n');
  return `---\n${m[1]}\n${block}\n---\n${src.slice(m[0].length)}`;
}
