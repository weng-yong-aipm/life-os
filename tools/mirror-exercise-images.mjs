#!/usr/bin/env node
/* One-time (re-runnable) mirror of licence-clean wger.de exercise images into
 * the public 'exercise-media' Supabase Storage bucket.
 *
 * wger's /exerciseimage/ endpoint exposes a per-image `license` id. Only
 * CC0 / CC-BY-4 / CC-BY-SA-3 are mirrored — never hotlinked at runtime, per
 * docs/superpowers/specs/2026-08-06-training-module-design.md §3. Matched to
 * the local catalogue (health/data/exercises.json) by English exercise name,
 * normalised for case/punctuation — exact match only: a wrong-exercise
 * attribution is worse than a missing image, so no fuzzy matching.
 *
 * Idempotent: skips any wger image id already recorded in
 * health/data/exercise-media.json. One image per exercise (prefers is_main).
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
const ALLOWED_LICENSE_SHORT_NAMES = new Set(['CC0', 'CC-BY 4', 'CC-BY-SA 3']);
const WGER = 'https://wger.de/api/v2';

const DRY = process.argv.includes('--dry');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] ?? process.argv[process.argv.indexOf(limitArg) + 1]) : null;

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
    const res = await fetch(next);
    if (!res.ok) throw new Error(`fetch ${next} failed: ${res.status}`);
    const body = await res.json();
    results.push(...body.results);
    next = body.next;
  }
  return results;
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

  // exercise-translation has no working `language` server-side filter —
  // filter client-side. Keep the first English name seen per exercise base id.
  const translations = await fetchAll(`${WGER}/exercise-translation/?format=json&limit=200`);
  const nameById = new Map();
  for (const t of translations) {
    if (t.language === 2 && !nameById.has(t.exercise)) nameById.set(t.exercise, t.name);
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
    const localName = localByNorm.get(norm(wgerName));
    if (!localName) { unmatchedWgerNames.add(wgerName); continue; }
    const current = chosen.get(localName);
    if (!current || (im.is_main && !current.is_main)) chosen.set(localName, im);
  }

  const toUpload = [...chosen.entries()].filter(([, im]) => !existingImageIds.has(im.id));
  const alreadyMirrored = chosen.size - toUpload.length;

  console.log(`Allowed-license images (CC0/CC-BY-4/CC-BY-SA-3): ${allowed.length}`);
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
    const imgRes = await fetch(im.image);
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
