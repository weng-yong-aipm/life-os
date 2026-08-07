#!/usr/bin/env node
/* One-time enrichment of health/data/exercises.json with the text fields
 * from yuhonas/free-exercise-db (Unlicense — the JSON text is safe to merge,
 * its images are NOT and must never be used; see
 * docs/superpowers/specs/2026-08-06-training-module-design.md §3).
 *
 * Matches by name, normalised for case/punctuation. Every existing field
 * (name, category, primaryMuscles, met — met feeds health/calories-burned.js)
 * is preserved untouched; only instructions/equipment/force/mechanic are added.
 *
 * --dry: fetch + compute + report only, never writes exercises.json. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCAL_PATH = `${ROOT}health/data/exercises.json`;
const SOURCE_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

const DRY = process.argv.includes('--dry');

function norm(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function main() {
  const local = JSON.parse(readFileSync(LOCAL_PATH, 'utf8'));

  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`fetch ${SOURCE_URL} failed: ${res.status}`);
  const source = await res.json();

  const byNorm = new Map();
  for (const entry of source) {
    const key = norm(entry.name);
    if (!byNorm.has(key)) byNorm.set(key, entry); // first wins on a rare dup
  }

  const usedKeys = new Set();
  let matched = 0;
  const merged = local.map((ex) => {
    const src = byNorm.get(norm(ex.name));
    if (!src) return ex;
    matched += 1;
    usedKeys.add(norm(ex.name));
    return {
      ...ex,
      instructions: src.instructions,
      equipment: src.equipment,
      force: src.force,
      mechanic: src.mechanic,
    };
  });

  const unmatchedLocal = local.length - matched;
  const unmatchedSource = [...byNorm.keys()].filter((k) => !usedKeys.has(k));

  console.log(`Local exercises (health/data/exercises.json): ${local.length}`);
  console.log(`free-exercise-db entries fetched: ${source.length}`);
  console.log(`Matched (enriched): ${matched}`);
  console.log(`Local exercises with no free-exercise-db match: ${unmatchedLocal}`);
  console.log(`free-exercise-db entries not used by any local exercise: ${unmatchedSource.length}`);

  if (DRY) {
    console.log('--dry: not writing health/data/exercises.json');
    return;
  }

  writeFileSync(LOCAL_PATH, JSON.stringify(merged));
  console.log(`Wrote ${merged.length} exercises to ${LOCAL_PATH}`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
