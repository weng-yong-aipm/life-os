#!/usr/bin/env node
/* Extract repo-relative file references from a memory entry, and classify each
 * one against every known repo root.
 *
 * The root map is the load-bearing part, not a config detail. Measured
 * 2026-08-17 against the live corpus: 789 references extracted; resolving
 * against AI-chatops alone calls 111 of them dead, against all six roots 66.
 * A report that is wrong about 40% of its rows stops being read, and then the
 * governance list is the blind spot it was built to close.
 *
 * Two states exist purely to keep false positives out of nominations:
 *   ambiguous — the same relative path exists under more than one root, so we
 *               cannot tell which one the entry meant. Never evidence.
 *   tail      — not found at the path as written, but a real file's trailing
 *               segments match it. Entries routinely write short paths
 *               (`src/api.js` for cockpit-react/src/api.js, `config/env.js` for
 *               src/config/env.js) — 7 of the 66 still-missing refs are exactly
 *               that. The file exists; only the path is imprecise. Retiring
 *               those would delete knowledge that is still true.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

const H = homedir();
export const DEFAULT_ROOTS = [
  join(H, 'AI-chatops'),
  join(H, 'life-os'),
  join(H, 'cs-flow-builder'),
  join(H, 'chatbot'),
  join(H, 'PersonalNotes'),
  join(H, 'Documents/DevNotes'),
];

/* Repo-relative paths only: a known top directory, then at least one more
 * segment, ending in an extension. The leading group rejects anything preceded
 * by `/` or a word character, so a URL path cannot masquerade as a repo path. */
const PATH_RE = /(^|[^\w/.-])((?:src|scripts|docs|tools|cockpit-react|tests|config)\/[\w./-]*\.\w{1,6})/g;

export function extractPaths(body) {
  const out = new Set();
  for (const m of body.matchAll(PATH_RE)) out.add(m[2]);
  return [...out].sort();
}

export function classify(ref, { roots, exists, findByTail }) {
  const hits = roots.filter((root) => exists(root, ref));
  if (hits.length > 1) return { state: 'ambiguous', roots: hits };
  if (hits.length === 1) return { state: 'alive', roots: hits };
  const at = findByTail ? findByTail(ref) : null;
  return at ? { state: 'tail', roots: [], at } : { state: 'missing', roots: [] };
}
