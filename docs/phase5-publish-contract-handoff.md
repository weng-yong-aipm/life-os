# Handoff — Desk & Shelf Phase 5: the publish contract + note writer

**Written 2026-08-05 from the life-os session.** Complete, drop-in implementation for spec items
18–21. Not applied, because `~/second-brain` is owned by a concurrent session that was mid-edit
(uncommitted `docs/reports/`) when this was written.

Everything below is grounded in the code as it actually stands, not in the spec's description of
it — two of the spec's premises have already turned out stale (see "Spec corrections" at the end).

## Preconditions — already satisfied

| Spec assumption | Reality (verified 2026-08-05) |
|---|---|
| Item 11: bump to `SCHEMA_VERSION=5` for the publish columns | **Already v6.** `backoffice/db.js` `knowledge_items` has `publish INTEGER NOT NULL DEFAULT 0`, `public_id TEXT`, `published_at TEXT`, plus `source_handle` and `transcript_path`. Nothing to migrate. |
| Upsert target on the Shelf | `learning_sessions_import_uk` — `unique (user_id, source, external_id) where external_id is not null`. Exists. |
| `learning_sessions.source` constrained to douyin/instagram/other | **No CHECK constraint** — the comment says `douyin \| instagram \| other`, but it is a plain `text` column. The coarse-class map below is therefore a *our* convention, not enforced by the DB. |

---

## Item 18 — `second-brain/scripts/publish-learning.mjs`

The whole safety argument is that this **constructs** a six-field object rather than filtering a
row. A future column added to `knowledge_items` cannot leak, because nothing here spreads.

```js
#!/usr/bin/env node
/* Phase 5 — the one code path that crosses Desk -> Shelf.
 *
 * It CONSTRUCTS six fields. It never spreads a row. That asymmetry is the whole
 * design: the failure mode of a future schema change becomes "I forgot to publish
 * something" (recoverable), never "I forgot to redact something" (not).
 *
 * One direction only. No reverse route, no daemon. Dropping the Shelf table and
 * clearing published_at must fully rebuild it — that is the test of the design. */

import { openDb } from '../backoffice/db.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID      = process.env.LIFE_OS_USER_ID;
if (!SUPABASE_URL || !SERVICE_KEY || !USER_ID) {
  console.error('need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIFE_OS_USER_ID');
  process.exit(1);
}

/* The Shelf gets a COARSE class, never the raw capture source. "douyin" is fine;
 * a creator handle or a short-link host is not. Anything unrecognised lands in
 * 'other' rather than passing through. */
const COARSE = {
  douyin: 'douyin', tiktok: 'douyin',
  instagram: 'instagram', threads: 'instagram',
  youtube: 'video', bilibili: 'video',
  x: 'social', reddit: 'social',
  rss: 'article', article: 'article', websearch: 'article',
  github: 'repo',
};
const coarseSource = (s) => COARSE[s] ?? 'other';

/* Six fields. Enumerated, not derived. Adding a field here is a deliberate act. */
function publicRow(item) {
  return {
    user_id:     USER_ID,
    external_id: item.public_id,
    source:      coarseSource(item.source),
    title:       item.title,
    summary:     item.summary ?? null,
    learned_on:  (item.captured_at || '').slice(0, 10),
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry');
  const db = openDb();

  const rows = db.prepare(`
    SELECT id, public_id, source, title, summary, captured_at
      FROM knowledge_items
     WHERE verdict = 'applied' AND publish = 1 AND published_at IS NULL
     ORDER BY captured_at
  `).all();

  if (!rows.length) { console.log('nothing to publish'); return; }

  /* public_id is the Shelf-facing identity. It must NOT be the Desk's internal id
   * (that would let a Shelf reader enumerate the private plane) and must be stable
   * across re-runs. Backfill it once, here, if the ingest path didn't set it. */
  const setPublicId = db.prepare('UPDATE knowledge_items SET public_id = ? WHERE id = ?');
  for (const r of rows) {
    if (!r.public_id) {
      r.public_id = crypto.randomUUID();
      if (!dryRun) setPublicId.run(r.public_id, r.id);
    }
  }

  const payload = rows.map(publicRow);

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log(`\n(dry) would publish ${payload.length}`);
    return;
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/learning_sessions?on_conflict=user_id,source,external_id`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(`upsert failed ${res.status}: ${(await res.text()).slice(0, 300)}`);

  /* Stamp only after the remote accepted, so a failure re-publishes next run
   * rather than silently dropping the item. */
  const stamp = db.prepare("UPDATE knowledge_items SET published_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?");
  const tx = db.transaction((ids) => { for (const id of ids) stamp.run(id); });
  tx(rows.map((r) => r.id));

  console.log(`published ${payload.length}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

Run: `node scripts/publish-learning.mjs --dry` first — it prints the exact JSON that would cross
the boundary. Read it before the first real run.

---

## Item 19 — the test that must never go red

`second-brain/scripts/publish-learning.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicRow, coarseSource } from './publish-learning.mjs';  // export both for the test

/* A 抖音 fixture whose caption and handle are distinctive strings. If either ever
 * appears in the emitted JSON, the boundary has leaked. */
const CAPTION = 'CAPTION_CANARY_不该出现在公开面';
const HANDLE  = 'HANDLE_CANARY_@creator';

const item = {
  id: 'desk-internal-id-must-not-leak',
  public_id: 'pub-123',
  source: 'douyin',
  source_handle: HANDLE,
  title: 'A title that is fine to publish',
  summary: 'A summary that is fine to publish',
  applied_note: CAPTION,
  transcript_path: '/Users/x/captures/inbox/secret.md',
  captured_at: '2026-08-05T10:00:00Z',
  project: 'life-os',
  tags: 'a,b',
};

test('emits exactly the six-field whitelist', () => {
  assert.deepEqual(
    Object.keys(publicRow(item)).sort(),
    ['external_id', 'learned_on', 'source', 'summary', 'title', 'user_id'],
  );
});

test('neither canary string appears anywhere in the JSON', () => {
  const json = JSON.stringify(publicRow(item));
  assert.ok(!json.includes(CAPTION), 'applied_note leaked');
  assert.ok(!json.includes(HANDLE), 'source_handle leaked');
  assert.ok(!json.includes(item.id), 'internal Desk id leaked');
  assert.ok(!json.includes('captures/inbox'), 'transcript path leaked');
});

test('an unknown source coarsens to other, it does not pass through', () => {
  assert.equal(coarseSource('some-new-platform'), 'other');
});
```

The third test is the one that catches the realistic future bug: someone adds a source to
`SOURCES` in `db.js` and forgets the `COARSE` map. Without it, the raw platform name reaches the
public plane.

---

## Item 21 — `backoffice/obsidian-note.js`

**Spec correction:** item 21 says "relocate `obsidian-export.js`". That file is **not in
second-brain** — it lives at `~/life-os/learning/obsidian-export.js`, on the *public* plane, with
`obsidian-export.test.js` beside it. Two consequences: it is a copy-in, not a move; and it is on
the Phase 7 deletion list, so copy it before that runs.

It already exports what is needed:

- `noteFilename(row)` — the filename convention
- `toNote(row)` — the markdown body

So Phase 5's note writer is a thin, write-once wrapper:

```js
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { noteFilename, toNote } from './obsidian-export.js';   // copied in from life-os

const VAULT = process.env.OBSIDIAN_VAULT_PATH;

/* Write-once, one-way. The vault is authored by a human in Obsidian; the Desk
 * contributes a note when an item is marked applied and never touches it again.
 * Overwriting would silently destroy whatever was written by hand afterwards. */
export function writeKnowledgeNote(row) {
  if (!VAULT) return { skipped: 'OBSIDIAN_VAULT_PATH unset' };
  const path = join(VAULT, 'Knowledge', noteFilename(row));
  if (existsSync(path)) return { skipped: 'exists' };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toNote(row), 'utf8');
  return { written: path };
}
```

Fire it where `verdict` transitions to `'applied'`, not on every save.

### Which vault path

`OBSIDIAN_VAULT_PATH` must point at **CloudDocs**:
`~/Library/Mobile Documents/com~apple~CloudDocs/Documents/DevNotes`

Not `~/Documents/DevNotes` — see the correction below.

---

## Item 20 — KB tab publish control

Add a `publish` checkbox and a "Publish N" button through the **existing `enqueue()`
serializer** in the backoffice UI. Do not add a second write path to `knowledge_items`; the
serializer exists because concurrent writes to the SQLite file corrupted state before.

---

## Spec corrections (verified on disk, 2026-08-05)

1. **Item 21's source file is on the wrong plane.** `obsidian-export.js` is in
   `~/life-os/learning/`, not second-brain. Copy it in *before* Phase 7 deletes
   `life-os/learning/obsidian-*.js`.
2. **Item 11 is already done and exceeded** — schema is v6, not v5, and already carries every
   publish column Phase 5 needs.
3. **Phase 1 item 7 is actively dangerous as written.** It calls `~/Documents/DevNotes` an
   orphan holding one stale session file and says `rm -rf` it. As of 2026-08-05 it holds **55
   files, 37 added in the preceding two days**, written by a live session — a credential
   *metadata* index (Keychain references only; verified free of `sk-ant-`, `otpauth://`, PEM
   blocks, passwords). Deleting it destroys active work.
   Decision 2026-08-05: those notes stay **local-only** and are deliberately NOT merged into the
   CloudDocs vault, because that vault auto-pushes to `github.com/YongSnsoft/devnotes` (work
   account) and the set includes colleagues' PROD agent accounts. Backup:
   `~/devnotes-documents-backup-20260805.tar.gz`.

## Done-check (spec, unchanged)

Mark one 抖音 item applied + publish → the note appears in `DevNotes/Knowledge/` and obsidian-git
autocommits within 10s → the deployed life-os learning page shows it with **no handle, no
caption, no link**. Then purge the 80 legacy douyin rows from Supabase.
