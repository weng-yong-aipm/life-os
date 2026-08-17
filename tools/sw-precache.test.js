import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Contract test for service-worker.js ASSETS.
 *
 * The service worker is network-first with a runtime cache.put(), so a file
 * missing from ASSETS is INVISIBLE while online — it gets cached the first time
 * you happen to visit that page. The only way to see the hole is a cold offline
 * load, which is exactly the situation this app is built for. That makes the
 * defect self-hiding, so it needs a check that reads the graph off disk instead
 * of trusting whoever last edited the list.
 *
 * Both directions are defects and both are checked:
 *   - reachable but not precached -> that file 404s on a cold offline load
 *   - precached but not on disk   -> install() uses addAll(), which is atomic,
 *     so ONE stale entry rejects the install and the SW never activates at all
 *
 * Deliberate scope limits, stated here so this file does not become the same
 * kind of quiet lie it exists to catch:
 *   - It resolves static specifiers only. A runtime-computed import path or a
 *     fetch() built from a variable is not visible to it.
 *   - It does not check that the precached bytes are the CURRENT bytes; that is
 *     what bumping CACHE is for, and nothing here enforces the bump.
 *   - Cross-origin refs are skipped on purpose (the fetch handler lets fonts,
 *     Supabase and the esm.sh Supabase client pass straight through).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Directories that are never served as part of the PWA. Everything else in the
// repo is app surface, so a new module directory is covered without editing
// this list — which is the point, since forgetting a whole module is the bug.
const NOT_APP = new Set(['.git', 'node_modules', 'docs', 'scripts', 'supabase', 'tools']);

// Extensions we know how to follow. A file with any other extension is a leaf:
// still precached, just not scanned for outgoing references.
const PARSERS = { '.html': refsFromHtml, '.js': refsFromJs, '.css': refsFromCss };

function stripUrlSuffix(ref) {
  return ref.split('?')[0].split('#')[0];
}

function isCrossOrigin(ref) {
  return /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//');
}

function refsFromHtml(src) {
  return [...src.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
}

function refsFromJs(src) {
  const out = [];
  // Anchored at line start on purpose. An unanchored /import\s*['"]/ matches
  // inside ordinary code — getElementById('learn-import').addEventListener('…')
  // yields a bogus specifier — and a bogus specifier here would surface as a
  // phantom broken reference, i.e. a false alarm that trains people to ignore
  // this test.
  for (const m of src.matchAll(/^[ \t]*(?:import|export)\b[^;'"]*\bfrom\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of src.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of src.matchAll(/(?<![.\w$])import\s*\(\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  // fetch() of a static path is a precache dependency just as much as an import:
  // health.js and the training pages load their JSON catalogues this way.
  for (const m of src.matchAll(/(?<![.\w$])fetch\s*\(\s*['"`]([^'"`]+)['"`]/g)) out.push(m[1]);
  return out;
}

function refsFromCss(src) {
  return [...src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
}

/** Every .html file under the app surface, repo-relative. */
function appPagesOnDisk() {
  const pages = [];
  (function descend(rel) {
    for (const entry of readdirSync(path.join(ROOT, rel || '.'), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!NOT_APP.has(entry.name)) descend(child);
      } else if (entry.name.endsWith('.html')) {
        pages.push(child);
      }
    }
  })('');
  return pages.sort();
}

/** ASSETS entries, repo-relative and normalised. './' means index.html. */
function parseAssets() {
  const src = readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const block = src.match(/const ASSETS\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(block, 'could not find the ASSETS array literal in service-worker.js');
  const raw = [...block[1].matchAll(/['"]([^'"]*)['"]/g)].map((m) => m[1]);
  return raw.map((entry) => {
    const rel = stripUrlSuffix(entry).replace(/^\.\//, '');
    // './' is the navigation root, not a file. It resolves to index.html, and
    // the existence check has to know that or it reports a phantom stale entry.
    return { entry, rel: rel === '' ? 'index.html' : rel };
  });
}

/**
 * Breadth-first walk of the real reference graph on disk.
 * Returns the reachable file set plus any reference that pointed nowhere.
 */
function walk(seeds) {
  const reachable = new Set();
  const broken = [];
  const queue = [...seeds];
  while (queue.length) {
    const rel = queue.shift();
    if (reachable.has(rel)) continue;
    reachable.add(rel);
    const abs = path.join(ROOT, rel);
    const parse = PARSERS[path.extname(rel).toLowerCase()];
    if (!parse) continue;
    for (const found of parse(readFileSync(abs, 'utf8'))) {
      if (!found || found.startsWith('#') || isCrossOrigin(found)) continue;
      const ref = stripUrlSuffix(found);
      if (!ref) continue;
      const target = path.relative(ROOT, path.resolve(path.dirname(abs), ref));
      if (!existsSync(path.join(ROOT, target))) broken.push({ from: rel, ref: found, target });
      else queue.push(target);
    }
  }
  return { reachable, broken };
}

const PAGES = appPagesOnDisk();
const ASSETS = parseAssets();
const ASSET_RELS = new Set(ASSETS.map((a) => a.rel));

// The graph is seeded from the pages on disk and NOTHING else. Seeding it from
// ASSETS as well is the obvious-looking version and it is wrong: it makes
// `reachable ⊇ ASSETS` true by construction, so the coverage assertion below
// can no longer fail and the parser canaries stay green even with the JS
// reference extractor stubbed out to return nothing. Found by stubbing it.
// Seeding from disk also means dropping a page from ASSETS does not delete its
// subtree from the graph — the check has to keep seeing what the list forgot.
const { reachable, broken } = walk(PAGES);
const REACHABLE_FILES = [...reachable].sort();

/* ---- non-vacuity guards -----------------------------------------------
 * This repo has been bitten repeatedly by checks that pass because they
 * examined nothing. Everything below asserts the scan actually happened; if any
 * of these fail, the coverage assertions further down mean nothing regardless
 * of whether they are green. */

test('the page scan finds the app pages (an empty scan is a failure, not a pass)', () => {
  assert.ok(PAGES.length >= 10, `expected the app's HTML pages, found ${PAGES.length}: ${PAGES.join(', ')}`);
  assert.ok(PAGES.includes('index.html'), 'the root index.html was not discovered — the walker is looking in the wrong place');
});

test('ASSETS parses to a non-empty list', () => {
  assert.ok(ASSETS.length >= 10, `parsed only ${ASSETS.length} ASSETS entries — the array regex probably stopped matching`);
});

test('the reference walk actually traverses (graph is bigger than its seeds)', () => {
  assert.ok(
    REACHABLE_FILES.length > PAGES.length,
    `walk reached ${REACHABLE_FILES.length} files from ${PAGES.length} pages — it followed no references at all`
  );
  // shared/local-date.js is the deepest cheap canary available: no HTML names
  // it, it is only reachable as index.html -> shell.js -> demo.js -> here. If
  // the JS import regex ever breaks, this is the assertion that says so instead
  // of the whole suite silently going green on a two-node graph.
  assert.ok(
    reachable.has('shared/local-date.js'),
    'transitive JS imports are not being followed — shared/local-date.js is three hops deep and was not reached'
  );
  // Same idea for the fetch() edge: nothing imports this JSON, it is only
  // fetched by string literal from the training pages.
  assert.ok(
    reachable.has('health/data/exercise-media.json'),
    'static fetch() paths are not being followed — health/data/exercise-media.json was not reached'
  );
});

test('every reference on disk resolves (a typo would poison the graph silently)', () => {
  const lines = broken.map((b) => `  ${b.from} -> "${b.ref}" (resolves to ${b.target}, which does not exist)`);
  assert.equal(broken.length, 0, `dangling references found:\n${lines.join('\n')}`);
});

/* ---- the contract ------------------------------------------------------ */

test('every app page is precached (a whole module can go missing otherwise)', () => {
  const missing = PAGES.filter((p) => !ASSET_RELS.has(p));
  assert.deepEqual(
    missing,
    [],
    `these pages exist on disk but are not in ASSETS, so they cannot cold-load offline:\n${missing.map((p) => `  './${p}',`).join('\n')}`
  );
});

test('every file reachable from a precached entry point is itself precached', () => {
  const missing = REACHABLE_FILES.filter((f) => !ASSET_RELS.has(f));
  assert.deepEqual(
    missing,
    [],
    `${missing.length} file(s) are reachable from a precached page but absent from ASSETS in service-worker.js.\n` +
      `Each one 404s on a cold offline load. Add to ASSETS:\n${missing.map((f) => `  './${f}',`).join('\n')}`
  );
});

test('every ASSETS entry exists on disk (addAll is atomic — one stale path kills install)', () => {
  const stale = ASSETS.filter((a) => !existsSync(path.join(ROOT, a.rel))).map((a) => a.entry);
  assert.deepEqual(
    stale,
    [],
    `ASSETS names ${stale.length} path(s) that are not on disk. addAll() rejects on the first 404, ` +
      `so the service worker will never activate and the app has NO offline mode at all:\n${stale.map((e) => `  ${e}`).join('\n')}`
  );
});

test('no ASSETS entry is dead weight (nothing reaches it)', () => {
  // Not a correctness bug the way the two above are, but an entry nothing can
  // reach is either a leftover or a sign the graph walk lost an edge — both
  // worth a look before it rots into the stale entry that breaks install().
  const orphans = ASSETS.filter((a) => !reachable.has(a.rel)).map((a) => a.entry);
  assert.deepEqual(orphans, [], `ASSETS entries unreachable from any app page:\n${orphans.map((e) => `  ${e}`).join('\n')}`);
});

/* The hole this file had until 2026-08-17.
 *
 * Every check above strips `?v=N` from both sides before comparing, so
 * './ui.css' in ASSETS scored as covering '../ui.css?v=7'. At runtime they are
 * different cache keys — caches.match defaults to ignoreSearch:false — and the
 * app was genuinely broken on a cold offline load while this suite stayed
 * green. Stripping is still the right thing for the reachability walk; what was
 * missing is any assertion about the side that does the matching.
 *
 * WHAT THIS FILE STILL CANNOT CHECK: that the cached response is correct, that
 * install actually succeeded on a real device, or that a runtime-cached entry
 * from an earlier online visit is not masking a missing precache entry. Only a
 * cold load with the origin unreachable shows that.
 */
test('the fetch handler matches the cache with ignoreSearch (precache stores unsuffixed paths)', () => {
  const sw = readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const match = sw.match(/caches\.match\(([^)]*)\)/);
  assert.ok(match, 'no caches.match call found — the offline fallback is gone');
  assert.match(
    match[1],
    /ignoreSearch:\s*true/,
    'caches.match must pass { ignoreSearch: true }: ASSETS holds clean paths while every page requests ?v=N, ' +
    'so without it the precached copy is never found and the app is broken offline',
  );
});

test('the referenced files really do carry query suffixes (this guard is not theoretical)', () => {
  // If nothing were suffixed, the assertion above would be dead weight and
  // someone would rightly delete it. Prove the situation it guards exists.
  const suffixed = [];
  for (const rel of appPagesOnDisk()) {
    const html = readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"]*\?v=[^"]*)"/g)) suffixed.push(`${rel} → ${m[1]}`);
  }
  assert.ok(suffixed.length > 0, 'expected at least one ?v= reference; if these are all gone, the ignoreSearch guard can go too');
});
