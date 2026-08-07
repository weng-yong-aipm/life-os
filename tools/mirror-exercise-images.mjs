#!/usr/bin/env node
/* One-time (re-runnable) mirror of licence-clean wger.de exercise images into
 * the public 'exercise-media' Supabase Storage bucket.
 *
 * wger's /exerciseimage/ endpoint exposes a per-image `license` id. Allowed:
 * CC0 (3) / CC-BY 4 (4) / CC-BY-SA 3 (1) / CC-BY-SA 4 (2) — the 3-and-4 share-
 * alike licences are the same permission family (redistributable with
 * attribution and share-alike), so both are mirrored. ODbL (5) is excluded —
 * it's a database licence, not an image licence — per
 * docs/superpowers/specs/2026-08-06-training-module-design.md §3.
 *
 * Matched to the local catalogue (health/data/exercises.json) by English
 * exercise name, normalised for case/punctuation — exact match only: a
 * wrong-exercise attribution is worse than a missing image, so no fuzzy
 * matching. NAME_MAP below is a hand-validated second pass for wger names
 * that differ stylistically from the local catalogue (e.g. "Bench Press" vs
 * "Barbell Bench Press - Medium Grip") — every pair was checked against both
 * sides before being added. Never add fuzzy/similarity matching here.
 *
 * Idempotent: skips any wger image id already recorded in
 * health/data/exercise-media.json. One image per exercise (prefers is_main).
 *
 * wger rate-limits aggressively (went unreachable for ~an hour after rapid
 * sequential fetches on 2026-08-07) — every request to wger.de sleeps
 * WGER_DELAY_MS afterward. Supabase upload requests are not throttled.
 *
 * Requires in life-os/.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * --dry: fetch + compute + report only, never uploads or writes the JSON file.
 * --limit N: only consider the first N allowed-license images (after sorting
 *   by id, for a stable/small trial run). */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEDIA_PATH = join(ROOT, 'health/data/exercise-media.json');
const LOCAL_PATH = join(ROOT, 'health/data/exercises.json');
const BUCKET = 'exercise-media';
const ALLOWED_LICENSE_SHORT_NAMES = new Set(['CC0', 'CC-BY 4', 'CC-BY-SA 3', 'CC-BY-SA 4']);
const WGER = 'https://wger.de/api/v2';
const WGER_DELAY_MS = 1500;

// Hand-validated: wger's English exercise name -> the matching local
// catalogue name, for pairs the normalised exact match misses. Every entry
// was checked against both sides — the wger name has an image and the local
// name exists in health/data/exercises.json.
const NAME_MAP = {
  'Bench Press': 'Barbell Bench Press - Medium Grip',
  'Benchpress Dumbbells': 'Dumbbell Bench Press',
  'Incline Bench Press - Barbell': 'Barbell Incline Bench Press - Medium Grip',
  'Biceps Curls With Barbell': 'Barbell Curl',
  'Biceps Curls With Dumbbell': 'Dumbbell Bicep Curl',
  'Bent Over Rowing': 'Bent Over Barbell Row',
  'Deadlifts': 'Barbell Deadlift',
  'Front Squats': 'Front Barbell Squat',
  'Shoulder Press, Barbell': 'Barbell Shoulder Press',
  'Shoulder Press, Dumbbells': 'Dumbbell Shoulder Press',
  'Close-grip Lat Pull Down': 'Close-Grip Front Lat Pulldown',
  'Barbell Triceps Extension': 'Lying Triceps Press',
  'Overhead Triceps Extension': 'Standing Dumbbell Triceps Extension',
  'Dips': 'Parallel Bar Dip',
  'Lunges': 'Barbell Lunge',
  'Leg Extension': 'Leg Extensions',
  'Hyperextensions': 'Hyperextensions (Back Extensions)',
};

const DRY = process.argv.includes('--dry');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] ?? process.argv[process.argv.indexOf(limitArg) + 1]) : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetch() a wger.de URL, then sleep — every call site that talks to wger
 * goes through this so the whole script stays under the rate limit. */
async function fetchWger(url, opts) {
  const res = await fetch(url, opts);
  await sleep(WGER_DELAY_MS);
  return res;
}

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
const SB = ENV.SUPABASE_URL;
const SVC = ENV.SUPABASE_SERVICE_ROLE_KEY;

function norm(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function fetchAll(url) {
  const results = [];
  let next = url;
  while (next) {
    const res = await fetchWger(next);
    if (!res.ok) throw new Error(`fetch ${next} failed: ${res.status}`);
    const body = await res.json();
    results.push(...body.results);
    next = body.next;
  }
  return results;
}

/** local catalogue name for a wger exercise's English name: exact-normalised
 * match first, then the hand-validated NAME_MAP. Never fuzzy. */
function resolveLocalName(localByNorm, wgerName) {
  const exact = localByNorm.get(norm(wgerName));
  if (exact) return exact;
  const mapped = NAME_MAP[wgerName];
  if (mapped && localByNorm.has(norm(mapped))) return localByNorm.get(norm(mapped));
  return null;
}

async function main() {
  const local = JSON.parse(readFileSync(LOCAL_PATH, 'utf8'));
  const localByNorm = new Map(local.map((e) => [norm(e.name), e.name]));

  const existing = existsSync(MEDIA_PATH) ? JSON.parse(readFileSync(MEDIA_PATH, 'utf8')) : [];
  const existingImageIds = new Set(existing.map((m) => m.wgerImageId).filter(Boolean));

  const licenses = await fetchAll(`${WGER}/license/?format=json&limit=100`);
  const allowedLicenseIds = new Map(
    licenses.filter((l) => ALLOWED_LICENSE_SHORT_NAMES.has(l.short_name)).map((l) => [l.id, l.short_name])
  );

  // exerciseinfo's `language` query param does not reliably filter the
  // translations array — filter client-side. Each entry's `translations`
  // holds one row per language; take the one with language === 2 (English).
  const info = await fetchAll(`${WGER}/exerciseinfo/?format=json&language=2&limit=200`);
  const nameById = new Map();
  for (const ex of info) {
    const en = (ex.translations || []).find((t) => t.language === 2);
    if (en && !nameById.has(ex.id)) nameById.set(ex.id, en.name);
  }

  const images = await fetchAll(`${WGER}/exerciseimage/?format=json&limit=200`);
  let allowed = images
    .filter((im) => allowedLicenseIds.has(im.license))
    .sort((a, b) => a.id - b.id);
  if (LIMIT) allowed = allowed.slice(0, LIMIT);

  // One image per matched local exercise: prefer is_main, else first seen.
  const chosen = new Map(); // localName -> image
  const unmatchedWgerNames = new Set();
  let noTranslation = 0;
  for (const im of allowed) {
    const wgerName = nameById.get(im.exercise);
    if (!wgerName) { noTranslation += 1; continue; }
    const localName = resolveLocalName(localByNorm, wgerName);
    if (!localName) { unmatchedWgerNames.add(wgerName); continue; }
    const current = chosen.get(localName);
    if (!current || (im.is_main && !current.is_main)) chosen.set(localName, im);
  }

  const toUpload = [...chosen.entries()].filter(([, im]) => !existingImageIds.has(im.id));
  const alreadyMirrored = chosen.size - toUpload.length;

  console.log(`Allowed-license images (CC0/CC-BY-4/CC-BY-SA-3/CC-BY-SA-4): ${allowed.length}`);
  console.log(`Matched to a local exercise by name: ${chosen.size}`);
  console.log(`Already mirrored (skipped, idempotent): ${alreadyMirrored}`);
  console.log(`Would upload: ${toUpload.length}`);
  console.log(`wger images with no English translation: ${noTranslation}`);
  console.log(`wger names with no local-catalogue match: ${unmatchedWgerNames.size}`);
  console.log(`Local exercises that would still have no image: ${local.length - chosen.size}`);

  if (DRY) {
    console.log('--dry: not uploading or writing health/data/exercise-media.json');
    return;
  }

  if (!SB || !SVC) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');

  const newRecords = [];
  for (const [localName, im] of toUpload) {
    const ext = (im.image.split('.').pop() || 'jpg').split('?')[0];
    const path = `${slugify(localName)}/${im.id}.${ext}`;
    const imgRes = await fetchWger(im.image);
    if (!imgRes.ok) { console.error(`skip ${localName}: could not fetch ${im.image} (${imgRes.status})`); continue; }
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const upRes = await fetch(`${SB}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SVC,
        Authorization: `Bearer ${SVC}`,
        'Content-Type': imgRes.headers.get('content-type') || 'image/jpeg',
      },
      body: bytes,
    });
    if (!upRes.ok) { console.error(`upload failed for ${localName}: ${upRes.status} ${await upRes.text()}`); continue; }
    newRecords.push({
      exercise: localName,
      path,
      license: allowedLicenseIds.get(im.license),
      licenseAuthor: im.license_author || 'wger.de contributors',
      sourceUrl: `https://wger.de/en/exercise/${im.exercise}/view/`,
      wgerImageId: im.id,
    });
    console.log(`Uploaded ${path}`);
  }

  writeFileSync(MEDIA_PATH, JSON.stringify([...existing, ...newRecords]));
  console.log(`Wrote ${existing.length + newRecords.length} record(s) to ${MEDIA_PATH}`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
