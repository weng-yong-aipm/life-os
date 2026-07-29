# life-os → Knowledge Platform — Design Blueprint

**Date:** 2026-07-29
**Status:** Draft for review
**Scope:** Turn life-os from a set of independent tracker modules into a connected
personal knowledge platform: an Obsidian knowledge layer, AI-generated learning
materials, cross-platform connectors, a universal task-ID/dedup foundation, and a
back-office (wide desktop admin) UI.

---

## 1. Goal

Today life-os is a browser PWA with 5 modules (Finance, Health, Goals & Certs,
Learning, Invest) writing to 9 Supabase tables. Each module is an island. This
blueprint connects them into one substrate where:

- Notes and records live as **Obsidian markdown** *and* as Supabase rows (two views of one truth).
- Captured learning (抖音 ledger, Learning sessions) is turned into **study materials** automatically.
- Every record carries a **stable ID + source key** so nothing is ever imported or advised twice.
- The UI reads like a **back-office admin console**, not a narrow phone column.

---

## 2. Current architecture (baseline)

```
Browser PWA (vanilla ES modules, no build)
  hub index.html → per-module index.html + <module>.js + <module>-repo.js
  shared: db.js (getClient/cloudEnabled), auth.js, ui.css (Daybook, 960px centered)
        │
        ▼
Supabase — Postgres + RLS (auth.uid()=user_id) + Storage + Edge Functions (Deno, Claude vision)
  tables: receipts, receipt_items, work_hours, pay_settings, expenses,
          meals, workouts, learning_sessions, career_goals
```

Deployed public + live: https://yongsnsoft2025-a11y.github.io/life-os/

---

## 3. The hard constraint (why this isn't just CSS + SQL)

A browser page **cannot** reach the local filesystem sandbox or drive an app with no
public API. Two of the asks live outside the browser:

- **Obsidian vault** = local `.md` files. The PWA can't watch or write them.
- **NotebookLM** = no public API; only a web UI.

So the platform needs a **local companion process on the Mac** — a small Node daemon
(`tools/lifeos-bridge.mjs`) — that owns filesystem + browser-automation duties and
talks to Supabase with the service-role key (already in `~/life-os/.env`, gitignored).
The PWA stays a thin read/write client; the bridge does the off-browser work.

```
Obsidian vault (~/life-os-vault, local .md)
        ▲  │  file watch + write
        │  ▼
  lifeos-bridge.mjs  ── browser-harness ──▶  NotebookLM / 抖音 / web
   (Node daemon, service-role)
        ▲  │  REST upsert / poll
        │  ▼
     Supabase  ◀──────────  life-os PWA (browser, anon key + RLS)
```

**This is the one genuine architecture change.** Everything else (UI, ID scheme) is
conventional web work.

---

## 4. W4 — Import-dedup foundation (build FIRST)

**Corrected during implementation (2026-07-29).** The original plan was to blanket-add
`source`/`source_key` to *every* table. Execution revealed that collides with existing
domain columns and duplicates an existing pattern:
- `meals.source` already means *logging method* (`photo`/`search`/`manual`).
- `learning_sessions.source` already means *capture platform* (`douyin`/`instagram`/`other`).
- `feed_items` already dedups via `unique(user_id, external_id)` + a `platform` column.

So the correct, codebase-consistent design (follow `feed_items`' pattern, don't invent a
parallel one): **dedup only where external imports actually land, using `external_id`,
reusing each table's existing `source`.** Finance/health/career rows are manual-entry —
they get dedup columns only when a real importer needs them (YAGNI).

**Delivered schema (learning_sessions — the 抖音/Obsidian import target):**

| Column | Meaning |
|---|---|
| `source text` (pre-existing) | capture platform, extended to include `obsidian`/`notebooklm` (plain text, no enum) |
| `external_id text` (new) | the origin's own id (抖音 video id, Obsidian note UID) |
| `synced_at timestamptz` (new) | last bridge sync (null = never) |

**Constraint:** `unique (user_id, source, external_id) where external_id is not null`.
Re-import = `upsert on conflict (user_id, source, external_id)` → **idempotent by construction.**
`feed_items` already satisfies this via its own `(user_id, external_id)` unique.

No helper file and no repo-insert changes were needed (the manual `add()` paths keep
their existing `source`; the importer that sets `external_id` arrives in W5). Delivered
as two migrations (the corrective one supersedes the initial blanket attempt).

---

## 5. W2 — Obsidian knowledge layer

**Vault:** a **new dedicated** `~/life-os-vault/` — **never** `~/Documents/DevNotes`
(that stays untouched per the standing rule). One folder per module
(`finance/`, `health/`, `learning/`, `goals/`, `feed/`).

**Note format:** one `.md` per record, YAML frontmatter is the join contract:

```yaml
---
lifeos_id: <uuid>          # = Supabase row id
source: obsidian
source_key: <uuid>         # stable, generated on first create
module: learning
created: 2026-07-29T…
updated: 2026-07-29T…
---
free-form markdown body (the human-editable knowledge)
```

**Sync (bridge daemon):**
- Watches the vault (chokidar) → on change, upsert the row into Supabase keyed by `(source, source_key)`.
- Polls Supabase (or Realtime) → on new/changed row, writes/updates the matching `.md`.
- Runtime: run `node tools/lifeos-bridge.mjs` on demand for v1; optional LaunchAgent for always-on later.

**Authority — split by data type (not one global SoR).** This is the pattern the
抖音 creators actually use (坏猫404's Karpathy 知识库: markdown *is* the brain,
frictionless-capture + continuous-output; 起点's Obsidian 工作台: Obsidian holds the
knowledge, the app is a workbench on top) and matches Karpathy's "knowledge base, not
RAG":

| Data | System of record | Sync role of the other side |
|---|---|---|
| **Structured tracker numbers** (receipts, pay hours, kg×reps, macros, goal %) | **Supabase** | Obsidian gets a read-only mirror note for linking/search |
| **Knowledge / prose** (learning notes, captured 抖音/ideas, second-brain) | **Obsidian** (markdown canonical) | Supabase stores an index row (title, tags, `source_key`) for app display + search only |

So numbers live in Postgres; the "brain" lives in markdown. Conflict handling is then
trivial — each field has exactly one owner, so a change on the non-owning side is
overwritten by the owner on next sync (no merge logic needed for v1).

**Result:** every tracked item is browsable/linkable/searchable in Obsidian (graph,
backlinks, plugins) *and* queryable in life-os — the "trains on you over time" vision.

**v1 shipped (2026-07-29): both directions, run-by-hand.**
- **Export (Supabase → Obsidian):** `learning/obsidian-export.js` (pure `toNote`,
  5 tests) + `tools/export-obsidian.mjs`. One stable-named `.md` per
  learning_sessions row in `~/life-os-vault/learning/` with join-key frontmatter.
  Verified live: 80 notes, idempotent.
- **Reverse (Obsidian → Supabase):** `learning/obsidian-parse.js` (pure `parseNote`,
  round-trip tested, 4 tests) + `tools/import-obsidian.mjs`. Pushes Obsidian's
  authoritative prose (title + summary) back, matched by `lifeos_id`; structured
  fields never touched. Verified live: a note edit reached the DB; idempotent.

**W2 daemon shipped (2026-07-29).** `tools/lifeos-bridge.mjs` — run-by-hand
long-running daemon: initial full export, `fs.watch` (built-in, no chokidar) →
debounced reverse-sync, 30s re-export poll. **Loop-prevention** via a pure,
unit-tested `tools/loop-guard.js` (content-hash + TTL: ignore the daemon's own
write echoes; a user edit changes the hash → synced). Built + adversarially
verified via workflow — loop-prevention PASSED; the found lost-update race (poll
clobbering an in-flight edit) is fixed (skip re-writing paths with a pending edit
or divergent on-disk content). 6 loop-guard tests pass.

---

## 6. W3 — Learning-material generation (Learning module)

**Honest reality:** NotebookLM has no API; browser-automating it is fragile. So:

- **Primary (reliable):** the bridge feeds captured learning (learning_sessions +
  抖音 ledger `~/douyin-learning/index.json` + vault notes) to **Claude** (the
  `ANTHROPIC_API_KEY` already wired for edge functions) → generates a **study guide,
  flashcards, and a quiz** → stored as a `learning_materials` row + a vault note,
  surfaced in the Learning module.
- **Optional enrichment (manual/browser-automated):** the bridge assembles a source
  bundle and pushes it to a **NotebookLM notebook** via `browser-harness` for its
  audio-overview/podcast feature; the generated artifact link is logged back. Treated
  as best-effort, not a hard dependency.

New table `learning_materials` (id, user_id, learning_session_id, model, content
jsonb, created_at) + a **Materials** tab in the Learning module.

**v1 shipped (2026-07-29): Claude generator (NotebookLM deferred as optional).**
`learning/study-material.js` (pure `buildRequest`/`parseMaterial`, 6 tests) uses
Claude structured outputs (`output_config.format`, `thinking: disabled`, model
`claude-opus-5`, swappable) → `{guide, flashcards[], quiz[]}`. `tools/gen-materials.mjs`
(dependency-free fetch to the Anthropic + PostgREST APIs, password-grant) upserts
into `learning_materials` on `(user_id, learning_session_id)` (idempotent). Migration
`20260729091040` applied. **Verified live on 1 row** (~1 Claude call): produced an
interview-grade guide + 6 flashcards + 3-question quiz from the 抖音 "message-queue /
long agent tasks" item. BILLABLE — `node tools/gen-materials.mjs [limit]`, default 1.
**Both shipped (2026-07-29).** Materials tab UI live (`materials-repo.js` + collapsible
guide/flashcards/quiz cards); full 80-row batch generated (80/80 items have materials).
**NotebookLM push** = `tools/push-notebooklm.mjs` + pure `learning/notebooklm-bundle.js`
(3 tests) — honest, no fake API: assembles all materials into one uploadable markdown
source at `~/life-os-vault/notebooklm/learnings-<label>.md` (verified live: 80 items,
300KB). User adds it to a NotebookLM notebook for chat/audio-overview.

---

## 7. W5 — Other platform connectors (later)

All ride on W4's `(source, source_key)` upsert + the bridge:
- **抖音 ledger** → import `~/douyin-learning/index.json` rows into `learning_sessions` (`source='douyin'`).
- **Lark / GDrive** → optional; pull docs into the vault + rows. Deferred until W2 is proven.

---

## 8. W1 — Back-office UI shell

Independent of everything above (pure frontend). Replaces the narrow reading layout
with a wide admin console.

- Remove `body { max-width: 960px }`; introduce a **persistent left sidebar** (module
  nav, always visible) + a **full-width content region** with denser tables.
- Delivered as a shared `shell.css` + `shell.js` that every module `index.html` pulls
  in (JS injects the sidebar so we don't hand-edit 5 files' markup twice).
- Keep the Daybook token system (colors/typography); change **layout only**, stay
  vanilla — no framework.
- Responsive: sidebar collapses to a top bar under ~800px so mobile still works.

Can be built in parallel with W4 (no shared files of consequence).

---

## 9. Phased rollout

| Phase | Workstream | Why this order | Rough size |
|---|---|---|---|
| **1** | W4 — ID/dedup foundation | Everything downstream needs it; cheap | S |
| **2** | W1 — Back-office shell | High-visibility, independent, no backend risk | M |
| **3** | W2 — Obsidian bridge | The real architecture step; needs W4 | L |
| **4** | W3 — Learning materials | Rides on W2 + Claude; NotebookLM optional | M |
| **5** | W5 — Connectors | Reuses W2+W4 plumbing | S each |

Each phase gets its own spec → plan → implement cycle. This doc is the umbrella.

---

## 10. Risks & open decisions (need your call before Phase 3)

1. **Bridge always-on?** v1 = run by hand; LaunchAgent later. OK?
2. **Vault location** `~/life-os-vault/` (new, dedicated) — confirm you want a fresh vault, not an existing one.
3. **System of record** — ✅ **RESOLVED (2026-07-29): split by data type** — Supabase authoritative for structured tracker numbers, Obsidian authoritative for knowledge/prose (per §5). Grounded in the 抖音 creators' pattern + Karpathy "knowledge base, not RAG".
4. **NotebookLM** stays *optional/best-effort* (Claude is the reliable generator). Agree?
5. **Bridge secret** uses the existing service-role key in `.env` — it runs only on your Mac, never shipped. OK.

**Phase order — ✅ RESOLVED (2026-07-29): W4 first, then W1** (W4 is the invisible
prerequisite for all sync/dedup; W1 is independent so no rework either way).

---

## 11. What ships when you approve

Phase 1 first PR: the `(source, source_key, synced_at)` migration + `withSource()` in
`db.js` + repo stamping + backfill — zero visible change, full idempotency. Then W1.
Nothing touches the concurrent **Feed** session's uncommitted work.
