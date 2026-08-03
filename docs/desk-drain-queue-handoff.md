# Handoff — Desk side of the phone capture bridge (Desk & Shelf Phase 4, items 15–17)

**Written 2026-08-03 from the life-os session.** The Shelf half is built and live; the Desk
half is below, unwritten, because that session was asked to stay out of `~/second-brain`.

## Done already (life-os / Supabase)

| Item | State |
|---|---|
| 15 · `capture_queue` migration | **Applied to remote.** `supabase/migrations/20260803150000_add_capture_queue.sql`, present in `migration list`. |
| 16 · `life-os/capture/` page | **Built.** `index.html`, `capture.js` (pure), `capture-repo.js` (insert-only), `capture-ui.js`, `capture.test.js` (7 tests). Wired into `shell.js` MODULES + DIRS. Full suite 82 pass / 0 fail. |
| 17 · `drain-queue.mjs` | **Not started — this handoff.** |

## The one design property to preserve

`capture_queue` has **an insert policy and nothing else**. No select, update, or delete policy
for authenticated users. Verified live on 2026-08-03 with a probe row present:

```
service-role read -> 1 row    (the Desk can drain)
anon read         -> 0 rows   (the page cannot read back)
```

That asymmetry is the entire reason a queue is allowed to exist on the public plane: a stolen
anon session can add junk to the queue and cannot learn anything from it. **Adding a select
policy, or a list view to `capture-repo.js`, silently removes it.**

## Schema

```sql
capture_queue(
  id         uuid pk default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  url        text not null,
  note       text,
  created_at timestamptz not null default now(),
  drained_at timestamptz
)
-- partial index: (user_id, created_at) where drained_at is null
```

## What to write: `second-brain/scripts/drain-queue.mjs`

Roughly 50 lines, per spec item 17. Outbound only.

1. `SELECT id, url, note FROM capture_queue WHERE drained_at IS NULL ORDER BY created_at` via
   PostgREST with the **service-role key** (RLS is bypassed; that is the intended path).
2. For each row `POST http://127.0.0.1:4173/api/ingest` with `{ url, note }`.
3. On success `PATCH capture_queue?id=eq.<id>` setting `drained_at = now()`.
4. On failure leave `drained_at` null so the next cycle retries — but count consecutive
   failures per id and stop retrying a URL that has failed, say, 5 times, or one dead link
   blocks the queue forever.
5. Purge sweep: `DELETE WHERE drained_at < now() - interval '30 days'`.

**The Desk keeps binding `127.0.0.1`.** Nothing here opens a port. That is why its ~51
unauthenticated routes — including `/api/credentials/reveal` and `/api/totp/code` — stay
unreachable from the LAN, and the done-check in the spec explicitly re-tests that.

### Lane hint is already computed

`life-os/capture/capture.js` exports `laneFor(url)` returning
`douyin | youtube | bilibili | x | threads | instagram | reddit | article`. It is **not**
stored on the row (the queue stays dumb on purpose), but the same function can be copied into
the Desk so `/api/ingest` picks a lane without a HEAD request first.

Note the bug that function already survived, in case the logic gets reimplemented: matching a
host with `/douyin\.com$/` also matches `notdouyin.com`. Match the registrable domain exactly
or as a dot-delimited suffix. There is a regression test for it.

### Credentials

`~/life-os/.env` holds `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`.
The Desk should read its own copy rather than reaching into the public repo's env file.

## Done-check (from the spec, unchanged)

Paste a 抖音 link on the phone → within one cycle a capture file and a `knowledge_items` row
exist locally and the queue row is stamped; `curl` from another LAN machine to `:4173` still
refuses.
