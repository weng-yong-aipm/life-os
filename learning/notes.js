/* Pure Obsidian-note parsing + selection — no I/O. Used by the indexer to turn
 * a .md file into a row, and shared shape for the Notes view. */

/* Split YAML frontmatter (--- ... ---) from the body. Returns {frontmatter, body}. */
export function splitFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: '', body: content };
  return { frontmatter: m[1], body: m[2] };
}

/* Pull tags from frontmatter (`tags: [a, b]` or `tags:\n  - a`) and inline #tags
 * in the body. Returns a deduped, order-preserving array without the leading #. */
export function extractTags(frontmatter, body) {
  const tags = [];
  const add = (t) => { const v = t.trim(); if (v && !tags.includes(v)) tags.push(v); };

  const inline = frontmatter.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) inline[1].split(',').forEach((t) => add(t.replace(/['"]/g, '')));
  const block = frontmatter.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (block) block[1].split('\n').forEach((l) => { const mm = l.match(/-\s*(.+)/); if (mm) add(mm[1].replace(/['"]/g, '')); });

  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  for (const mm of noCode.matchAll(/(?:^|\s)#([A-Za-z0-9_\-\/]{2,})/g)) add(mm[1]);
  return tags;
}

/* First readable paragraph, markdown stripped, capped at `max` chars. */
export function makeExcerpt(body, max = 220) {
  const text = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/* Parse a note file into a normalized record (no path/mtime — the caller adds those). */
export function parseNote(filename, content) {
  const base = filename.replace(/\.md$/i, '');
  const { frontmatter, body } = splitFrontmatter(content);
  const heading = body.match(/^#\s+(.+)$/m);
  const title = (heading ? heading[1] : base).trim();
  const tags = extractTags(frontmatter, body);
  const excerpt = makeExcerpt(body);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return { title, tags, excerpt, words };
}

/* Most-recently-modified first, capped. Expects rows with `modifiedAt` (ISO/date). */
export function recentNotes(notes, limit = 20) {
  return [...notes]
    .sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')))
    .slice(0, limit);
}
