# Feed → Digest module (life-os) — design

Status: design + seed data landed (`feed/sources.js`). Engine not built yet — awaiting one scope decision (see end).
Date: 2026-07-28. Grounded by the `learning-os-research` workflow (FDE/AI-PM bar, cert catalog, NotebookLM reality, top-20 creators/platform).

## Goal

Turn the **manual** `learning/` log into an **automated** pipeline: follow the top AI creators
across X / YouTube (incl. long video) / Reddit / Instagram-Threads / 抖音·Bilibili·小红书,
summarize what they publish, let me triage it (applied / considering / rejected), and roll it
into a weekly digest I can push into **NotebookLM** as a "smart learning database."

## Why a new module (not just extending `learning/`)

`learning/` is a browser PWA writing to Supabase. The **fetching** (`agent-reach`, `yt-dlp`) is a
**CLI on the Mac** — a browser can't call it. So ingestion lives in a **local Node script**; the
PWA only displays + triages. `feed/` = the ingestion engine + its own view; it *promotes* chosen
items into the existing `learning_sessions` table, so the two modules compose instead of overlap.

## Architecture

```
sources.js (curated follow-list, per platform)
      │
scripts/ingest-feed.mjs  ── runs on the Mac (manual or LaunchAgent/cron) ──┐
   1. for each READY platform → agent-reach fetch recent items             │
   2. summarize each via Claude API (ANTHROPIC_API_KEY in .env)            │
   3. dedupe (feed.js) + upsert into Supabase `feed_items`  ───────────────┘
      │
feed/ PWA view  ── reads feed_items, shows summaries, triage buttons
   • applied / considering / rejected  → promotes to learning_sessions
   • "This week's digest"              → feed.js rollup (pure, tested)
   • "Export for NotebookLM"           → one clean Markdown/Doc
      │
NotebookLM  ── single synced Google-Doc source → Audio Overview / mind map / Q&A
```

### Platform readiness (from `agent-reach doctor` + live testing, 2026-07-28)
- **Working now, zero-config (built into `ingest-feed.mjs`, both proven):** RSS/blogs (feedparser-style), YouTube (+ long-video transcripts via yt-dlp — validated: 6,881 cue lines from a 131-min video).
- **Needs the agent-reach login backend, NOT plain HTTP:** Bilibili (direct curl is risk-controlled → anti-bot HTML; needs `bili-cli` login or opencli), Reddit (anonymous `.json` blocked), X/Twitter, Instagram, 小红书 — all via `agent-reach install --channels opencli` + Chrome login.
- **No agent-reach channel:** 抖音 — use the existing Chrome-CDP `:9222` DOM extractor.
- Recommendation: RSS + YouTube are the shipped ready set; the rest light up once the one-time `agent-reach` logins are done, then a small fetcher per platform slots into `ingest-feed.mjs`.

### Data model — new table `feed_items`
`id, user_id, platform, source_handle, source_name, external_id (dedupe key), url, title,
published_at, fetched_at, raw_excerpt, summary, topics text[], duration_sec (video),
status ('new'|'applied'|'considering'|'rejected'), promoted_learning_id (fk, nullable)`
RLS: owner-only, same pattern as `learning_sessions` / `career_goals`.

### Pure logic (`feed/feed.js`, unit-tested like `weekly.js`)
- `dedupeByExternalId(items)` — drop already-seen.
- `weeklyDigest(items, isoWeekKey)` — group by platform + topic; counts; top items.
- `toMarkdownDigest(digest)` — the NotebookLM export string.

## NotebookLM integration (researched)

- **No public/personal API.** An official API exists only for **Gemini Enterprise / Agentspace**
  (`google.cloud.notebooklm.v1alpha`, gated + paid). NotebookLM was renamed **Gemini Notebook** (Jul 2026).
- **Recommended (ToS-safe, personal Pro account):** pipeline writes the weekly digest into **one
  Google Doc** via the official Docs API (fully automated on our side); keep that Doc as a single
  **synced source** in a standing "Weekly Learning" notebook; weekly = click *sync* + *generate
  Audio Overview*. Consolidating into one Doc also sidesteps the per-notebook source cap (~50 free).
- **Optional power-up (accept fragility):** the unofficial `notebooklm-py` agent skill can script
  the sync/generate step and mirror artifacts into Obsidian as wikilinked notes — a hands-off loop,
  but reverse-engineered and can break; don't make anything critical depend on it.

## Career/cert refinement (hand-off to the `career/` module — do NOT let me edit that file from here)

Research sharpens the existing `LEARNING_TRACK`/`FDE_STARTER` certs with real names/costs/priority:

**Priority 1 (do first):** Anthropic Academy courses (Claude Code/MCP/Agent Skills — *free*, official completion certs) · Claude Certified Developer (proctored ~$125 — **gated to Claude Partner Network orgs**, verify eligibility; avoid third-party "Claude cert" sites, they're fake).
**Priority 2:** AWS Certified AI Practitioner (AIF-C01, $100) · Claude Certified Architect ($125/$175) · DeepLearning.AI "Generative AI for Everyone" ($49, Andrew Ng — reads well for AI-PM).
**Priority 3:** GCP Professional ML Engineer ($200) *or* AWS ML Engineer Associate ($150) — pick by employer stack · Azure AI Engineer AI-102 ($165) · NVIDIA NCA-GENL ($125, real proctored assoc.) · PSM I ($200, faster than PMP for a PM pivot) · GCP Generative AI Leader ($99, strategy/PM).
**Priority 4-5 / optional:** Google AI Essentials ($49, below skill level, brand only) · Azure AI-900 · PMP ($425+, only if roles list it) · Pragmatic (employer-sponsored only) · AIPMM (⚠ borderline marketing — skip).

**Role bar (both share one crossover skill = "scope ambiguity → shippable + prove it with evals"):**
- **FDE top-end:** production LLM/agent systems + **eval harnesses you design** (the #1 tested skill), enterprise deploy (SSO/SAML, VPC, SOC2), client-facing judgment. $20k/mo = low-mid FDE band; frontier labs want 25-50% travel, so remote on-ramps = AI startups + SI Palantir/Anthropic practices (Deloitte/Accenture).
- **AI-PM top-end:** defines quality as a **versioned eval suite**, ships v1s in weeks, earns researcher trust, exceptional writing. Certs matter *less* here than 2-4 shipped projects + public writing.
- **Weng's wedge:** the existing chatbot answer-key/eval + agentic cockpit work → reframe as a flagship **eval case study** + mini-PRDs; it serves BOTH roles at once.

Full ranked creator lists per platform live in `feed/sources.js`.
```
```

## Open decision before building the engine
1. **Run mode:** (a) assisted — PWA queues sources, a Claude Code command pulls+summarizes on demand (simplest, works today); or (b) automated — Node cron + Supabase service-role writes (hands-off, more plumbing).
2. **First platforms:** ready-now set (YouTube+Bilibili+RSS+Reddit) first, defer X/IG/抖音 to after the one-time logins? (recommended.)
