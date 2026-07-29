/* Pure source-stamping helper for the dedup foundation (W4).
 * Every persisted row carries (source, source_key); an external import upserts
 * on (user_id, source, source_key) so re-imports are idempotent. */

export const SOURCES = ['manual', 'obsidian', 'douyin', 'notebooklm', 'lark', 'gdrive'];

export function withSource(record, source = 'manual', sourceKey = null) {
  if (!SOURCES.includes(source)) throw new Error(`unknown source: ${source}`);
  return { ...record, source, source_key: sourceKey };
}
