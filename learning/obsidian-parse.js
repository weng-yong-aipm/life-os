/* Pure parser: an Obsidian note (as written by obsidian-export.js) -> the prose
 * fields to sync back to Supabase. No I/O. The inverse of toNote for the fields
 * Obsidian owns under the authority split (title + summary body); the frontmatter
 * join keys (lifeos_id/source/external_id) are read but never edited by the user. */

export function parseNote(text) {
  const lines = String(text).split('\n');
  const fm = {};
  let i = 0;
  if (lines[0] === '---') {
    i = 1;
    for (; i < lines.length && lines[i] !== '---'; i++) {
      const idx = lines[i].indexOf(':');
      if (idx === -1) continue;
      const k = lines[i].slice(0, idx).trim();
      let v = lines[i].slice(idx + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      fm[k] = v;
    }
    i++; // skip the closing ---
  }

  let title = '';
  const summaryLines = [];
  for (const line of lines.slice(i)) {
    if (!title && line.startsWith('# ')) { title = line.slice(2).trim(); continue; }
    if (line.startsWith('🔗')) continue;        // derived link, not prose
    if (title) summaryLines.push(line);
  }
  const summary = summaryLines.join('\n').trim();

  return {
    lifeos_id: fm.lifeos_id || null,
    source: fm.source || null,
    external_id: fm.external_id || null,
    title,
    summary: summary || null,
  };
}
