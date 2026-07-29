/* Pure formatter: a learning_sessions row -> an Obsidian note (filename + text).
 * No I/O. Deterministic. The filename is stable per row so re-export overwrites
 * in place (idempotent). Knowledge lives in markdown (the authority split:
 * numbers=Supabase, prose=Obsidian). */

/* Stable filename: prefer source+external_id (human-readable, stable across
 * re-imports), else the row id. */
export function noteFilename(row) {
  const base = row.external_id ? `${row.source}-${row.external_id}` : row.id;
  return `${String(base).replace(/[^\w.-]/g, '_')}.md`;
}

function fmList(tags) {
  // YAML flow sequence; tags are hashtag tokens (no commas/brackets), safe unquoted.
  return `[${tags.join(', ')}]`;
}

export function toNote(row) {
  const fm = ['---', `lifeos_id: ${row.id}`, 'module: learning', `source: ${row.source}`];
  if (row.external_id) fm.push(`external_id: "${row.external_id}"`);
  if (row.learned_on) fm.push(`learned_on: ${row.learned_on}`);
  if (Array.isArray(row.tags) && row.tags.length) fm.push(`tags: ${fmList(row.tags)}`);
  if (row.synced_at) fm.push(`synced_at: ${row.synced_at}`);
  fm.push('---');

  const body = [`# ${row.title || 'Untitled'}`];
  if (row.summary) body.push('', row.summary);
  if (row.link) body.push('', `🔗 ${row.link}`);

  return { filename: noteFilename(row), content: `${fm.join('\n')}\n\n${body.join('\n')}\n` };
}
