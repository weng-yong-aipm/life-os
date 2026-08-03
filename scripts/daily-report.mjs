#!/usr/bin/env node
/* Daily attention report for the Feed module.
 *
 *   node scripts/daily-report.mjs [--days 2] [--limit 60] [--dry]
 *
 * Pulls the most recent feed_items across ALL topics/platforms and asks Claude
 * for one ranked "what needs my attention" briefing (macro/war/logistics +
 * MY/CN/US + AI/tech + posting opportunities), grounded and [n]-cited, written to
 *   docs/reports/daily-<YYYY-MM-DD>.md
 *
 * Meant to run after the morning ingest. Needs SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportPrompt, toOverviewMarkdown, briefingRow } from '../feed/synthesis.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* rely on process.env */ }
  return env;
}
const ENV = loadEnv();
const MODEL = ENV.FEED_MODEL || 'claude-sonnet-5';
const SB = ENV.SUPABASE_URL;
const SVC = ENV.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = { apikey: SVC, Authorization: `Bearer ${SVC}` };

async function getUserId() {
  if (ENV.LIFE_OS_USER_ID) return ENV.LIFE_OS_USER_ID;
  const res = await fetch(`${SB}/auth/v1/admin/users?per_page=1`, { headers: sbHeaders });
  const body = await res.json();
  const users = Array.isArray(body) ? body : body.users;
  return users && users.length ? users[0].id : null;
}
async function saveBriefing(date, bodyMd) {
  const userId = await getUserId();
  if (!userId) return;
  await fetch(`${SB}/rest/v1/feed_items?on_conflict=user_id,external_id`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([briefingRow({ kind: 'report', label: date, bodyMd, date, userId })]),
  });
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DAYS = Number(opt('--days', 2));
const LIMIT = Number(opt('--limit', 60));
const DRY = flag('--dry');

async function fetchRecent() {
  const sinceIso = new Date(Date.now() - DAYS * 86400000).toISOString();
  // Prefer items with a real summary (core-tier) so the brief has substance.
  const url = `${SB}/rest/v1/feed_items?select=platform,source_name,source_handle,title,summary,url,published_at,topics`
    + `&or=(published_at.gte.${sinceIso},published_at.is.null)`
    + `&order=summary.nullslast,published_at.desc.nullslast&limit=${LIMIT}`;
  const res = await fetch(url, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
  if (!res.ok) throw new Error(`query ${res.status}: ${await res.text()}`);
  return res.json();
}

async function report(items) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: buildReportPrompt(items) }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return (body.content || []).map((b) => b.text || '').join('');
}

async function main() {
  if (!SB || !SVC) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
  const items = await fetchRecent();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Daily report ${today}: ${items.length} recent item(s) across ${new Set(items.map((i) => i.platform)).size} platform(s), last ${DAYS}d.`);
  if (!items.length) { console.log('No recent items — run the ingest first, or widen --days.'); return; }

  if (!ENV.ANTHROPIC_API_KEY && !DRY) throw new Error('Set ANTHROPIC_API_KEY in .env (or pass --dry).');
  const text = DRY ? '_(dry run — no report)_\n\n## 🚨 Top of mind\n- (would call Claude here)' : await report(items);

  const md = toOverviewMarkdown(`Daily attention report — ${today}`, text, items, { days: DAYS, generatedAt: today });
  const dir = join(ROOT, 'docs', 'reports');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `daily-${today}.md`);
  writeFileSync(path, md);
  if (!DRY) await saveBriefing(today, md).catch((e) => console.log(`(briefing not saved: ${e.message})`));
  console.log(`\nWrote ${path}${DRY ? '' : ' + saved to Feed › Briefings'}\n`);
  console.log(md);
}

main().catch((e) => { console.error('Daily report failed:', e.message); process.exit(1); });
