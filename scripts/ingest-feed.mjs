#!/usr/bin/env node
/* On-demand feed ingest for the life-os Feed module.
 *
 *   node scripts/ingest-feed.mjs [rss|youtube|all] [--limit N] [--no-transcript] [--dry]
 *
 * Pulls recent items from the READY platforms in feed/sources.js (RSS + YouTube
 * via yt-dlp), summarizes each with the Claude API, and inserts them into the
 * Supabase `feed_items` table (existing rows are left untouched, so your triage
 * survives re-runs). Then open the Feed page and triage.
 *
 * Needs in .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 * Optional: LIFE_OS_USER_ID (else the first auth user is used), FEED_MODEL.
 */

import { readFileSync } from 'node:fs';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SOURCES, PLATFORMS } from '../feed/sources.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* ---------- config ---------- */
function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env — rely on process.env */ }
  return env;
}
const ENV = loadEnv();
const MODEL = ENV.FEED_MODEL || 'claude-sonnet-5';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const which = args.find((a) => !a.startsWith('-')) || 'all';
const LIMIT = Number((args[args.indexOf('--limit') + 1]) || (which === 'youtube' ? 3 : 6)) || 6;
const DRY = flag('--dry');
const NO_TRANSCRIPT = flag('--no-transcript');

/* ---------- Supabase REST ---------- */
const SB = ENV.SUPABASE_URL;
const SVC = ENV.SUPABASE_SERVICE_ROLE_KEY;
function sbHeaders(extra = {}) {
  return { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...extra };
}
async function getUserId() {
  if (ENV.LIFE_OS_USER_ID) return ENV.LIFE_OS_USER_ID;
  const res = await fetch(`${SB}/auth/v1/admin/users?per_page=1`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`admin/users ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const users = Array.isArray(body) ? body : body.users;
  if (!users || !users.length) throw new Error('No auth users found — sign in to life-os once, or set LIFE_OS_USER_ID.');
  return users[0].id;
}
async function insertItems(rows) {
  // ignore-duplicates → never clobber an already-triaged row on re-run
  const res = await fetch(`${SB}/rest/v1/feed_items?on_conflict=user_id,external_id`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------- Claude summarize ---------- */
async function summarize({ title, platform, sourceName, content }) {
  const prompt = `Summarize this ${platform} item for an AI engineer's learning log.\n` +
    `Source: ${sourceName}\nTitle: ${title}\n\nContent:\n${(content || '').slice(0, 8000)}\n\n` +
    `Reply with ONLY a JSON object: {"summary": "<=60 words, concrete takeaway", "topics": ["3-5","short","tags"]}.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const text = (body.content || []).map((b) => b.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { summary: text.slice(0, 280), topics: [] };
  try { const o = JSON.parse(m[0]); return { summary: o.summary || '', topics: Array.isArray(o.topics) ? o.topics : [] }; }
  catch { return { summary: text.slice(0, 280), topics: [] }; }
}

/* ---------- RSS ---------- */
function stripTags(s) { return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim(); }
function pick(block, tags) {
  for (const t of tags) {
    const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
    if (m) return stripTags(m[1].replace(/<!\[CDATA\[|\]\]>/g, ''));
  }
  return '';
}
function pickAttr(block, tag, attr) {
  const m = block.match(new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
}
async function fetchRss(src, limit) {
  const res = await fetch(src.feed, { headers: { 'user-agent': 'life-os-feed/1.0' } });
  if (!res.ok) throw new Error(`${res.status}`);
  const xml = await res.text();
  const blocks = xml.split(/<(?:entry|item)[\s>]/i).slice(1).slice(0, limit);
  return blocks.map((b) => {
    const link = pickAttr(b, 'link', 'href') || pick(b, ['link']) || pick(b, ['guid']);
    return {
      externalId: pick(b, ['id', 'guid']) || link,
      url: link,
      title: pick(b, ['title']) || '(untitled)',
      publishedAt: normDate(pick(b, ['published', 'updated', 'pubDate', 'dc:date'])),
      content: pick(b, ['content:encoded', 'content', 'summary', 'description']),
    };
  }).filter((i) => i.externalId);
}
function normDate(s) { const d = new Date(s); return isNaN(d) ? null : d.toISOString(); }

/* ---------- YouTube (yt-dlp) ---------- */
function ytList(channelUrl, limit) {
  const out = execFileSync('yt-dlp', ['-J', '--flat-playlist', '--playlist-end', String(limit),
    channelUrl.replace(/\/$/, '') + '/videos'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const data = JSON.parse(out);
  return (data.entries || []).map((e) => ({
    externalId: e.id,
    url: `https://www.youtube.com/watch?v=${e.id}`,
    title: e.title || '(untitled)',
    durationSec: e.duration ? Math.round(e.duration) : null,
  }));
}
function ytTranscript(videoUrl) {
  if (NO_TRANSCRIPT) return '';
  const dir = mkdtempSync(join(tmpdir(), 'ytsub-'));
  try {
    execFileSync('yt-dlp', ['--skip-download', '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en',
      '--sub-format', 'vtt', '-o', join(dir, '%(id)s.%(ext)s'), videoUrl],
      { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    const vtt = readdirSync(dir).find((f) => f.endsWith('.vtt'));
    if (!vtt) return '';
    const raw = readFileSync(join(dir, vtt), 'utf8');
    const lines = raw.split('\n')
      .filter((l) => l && !/-->/.test(l) && !/^\d+$/.test(l) && !/^(WEBVTT|Kind:|Language:)/.test(l))
      .map((l) => l.replace(/<[^>]+>/g, '').trim());
    return [...new Set(lines)].join(' ').slice(0, 8000);
  } catch { return ''; }
  finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

/* ---------- main ---------- */
function targetPlatforms() {
  const ready = Object.entries(PLATFORMS).filter(([, p]) => p.ready).map(([k]) => k);
  if (which === 'all') return ready.filter((p) => p === 'rss' || p === 'youtube'); // built-in fetchers so far
  if (!ready.includes(which)) throw new Error(`Platform "${which}" is not ready. Ready: ${ready.join(', ')}`);
  return [which];
}

async function run() {
  if (!SB || !SVC) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
  if (!ENV.ANTHROPIC_API_KEY && !DRY) throw new Error('Set ANTHROPIC_API_KEY in .env (or pass --dry).');
  const platforms = targetPlatforms();
  const userId = DRY ? '(dry)' : await getUserId();
  console.log(`Ingesting [${platforms.join(', ')}] · limit ${LIMIT}/source${DRY ? ' · DRY' : ''}\n`);

  let staged = [];
  for (const platform of platforms) {
    const srcs = SOURCES.filter((s) => s.platform === platform && (platform !== 'rss' || s.feed));
    for (const src of srcs) {
      try {
        const raw = platform === 'rss' ? await fetchRss(src, LIMIT)
          : ytList(src.url, LIMIT).map((v) => ({ ...v, content: ytTranscript(v.url) }));
        for (const it of raw) {
          const content = it.content || it.title;
          const { summary, topics } = DRY && !ENV.ANTHROPIC_API_KEY
            ? { summary: '(dry, no summary)', topics: [] }
            : await summarize({ title: it.title, platform, sourceName: src.name, content });
          staged.push({
            user_id: userId, platform, source_handle: src.handle, source_name: src.name,
            external_id: `${platform}:${it.externalId}`, url: it.url, title: it.title,
            published_at: it.publishedAt || null, duration_sec: it.durationSec || null,
            summary, topics: topics.length ? topics : null, status: 'new',
          });
          console.log(`  ✓ ${src.name}: ${it.title.slice(0, 70)}`);
        }
      } catch (err) {
        console.log(`  ✗ ${src.name} (${platform}): ${err.message.slice(0, 120)}`);
      }
    }
  }

  console.log(`\n${staged.length} item(s) staged.`);
  if (DRY) { console.log(JSON.stringify(staged, null, 2)); return; }
  if (!staged.length) return;
  const inserted = await insertItems(staged);
  console.log(`${inserted.length} new item(s) written (duplicates skipped). Open the Feed page to triage.`);
}

run().catch((e) => { console.error('Ingest failed:', e.message); process.exit(1); });
