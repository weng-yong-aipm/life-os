# life-os → Self-Improvement Engine — Design Blueprint

**Date:** 2026-07-29
**Status:** Draft for review
**Relation:** Companion to `2026-07-29-life-os-knowledge-platform-design.md`. That
doc connects the *data* (Obsidian + shared IDs); this one adds the *agentic loop*
that makes life-os improve itself and your environment over time.

---

## 1. What the user asked for

> "a self-learning module … based on how I use and interact with it can always
> enhance … check for updates for all MCP and skills and stuff … the new learning
> can update my current setup, command line, terminal, projects, company project,
> Obsidian, NotebookLM … overall improvement modules that can scan and based on
> the historical or interactive data enhance it."

Three capabilities, in increasing autonomy/risk:

1. **Observe → suggest** (usage-driven enhancement) — watch how each module is
   actually used; surface concrete improvements.
2. **Watch the ecosystem** (update radar) — track versions of MCP servers, Claude
   Code skills/plugins, CLI tools; flag what's stale and what's new.
3. **Act on the environment** (feedback loop) — turn accepted suggestions into real
   changes: config, skills, module code, Obsidian/NotebookLM. **Gated.**

---

## 2. Core principle: propose, don't auto-apply

An agent that silently rewrites your modules, skills, and MCP configs is a
foot-gun. So the engine is a **proposal generator with a human gate**, not an
autonomous editor. Every improvement becomes a reviewable **suggestion row**; you
approve → it's applied via the existing safe paths (a PR / a migration / a config
diff you see first). Nothing self-modifies without an explicit yes.

This mirrors [[cockpit-scan-verification-model]] (explicit gate, never false-green)
and the group-draft-only / confirm-before-others-edits standing rules.

---

## 3. Data model — one `improvements` table

```
improvements (
  id uuid pk, source text, source_key text,        -- dedup per knowledge-platform W4
  kind text,      -- 'module-enhance' | 'tool-update' | 'env-change'
  target text,    -- e.g. 'learning', 'mcp:codegraph', 'skill:ponytail', '~/.zshrc'
  title text, detail text, evidence jsonb,          -- what/why + the usage data behind it
  status text default 'proposed',                   -- proposed | approved | applied | dismissed
  created_at timestamptz, applied_at timestamptz
)
```

One inbox for every suggestion, whatever the origin. Rides on W4's
`(source, source_key)` idempotency so the same suggestion never doubles.

---

## 4. The three capabilities

### C1 — Usage-driven module enhancement (`scan`)
- **Input:** interaction history. Cheapest source first: the tables themselves
  (which modules have rows, which fields stay empty, which flows dead-end — e.g.
  this session already found *Learning→Goals was a dead end*), plus optional
  event logging later.
- **Engine:** a bridge/daemon job feeds the usage summary to Claude → returns
  concrete, scoped enhancement proposals → `improvements` rows (kind
  `module-enhance`).
- **v1 slice (safe, shippable now):** a read-only **"Coach" panel** — a rules-only
  scan (no LLM) that flags dead-ends and empty-field patterns. The Learning→Goals
  link shipped alongside this doc is the first hand-built example of what C1 will
  later propose automatically.

### C2 — Ecosystem update radar (`check-updates`)
- Scans installed **MCP servers** (npm/binary versions vs latest), **Claude Code
  skills & plugins** (marketplace/plugin manifests), and **CLI tools** (`codegraph
  upgrade` hint, `gh extension`, `npm outdated -g`, brew).
- Emits `tool-update` rows: name · current · latest · changelog link · one-line
  "why care".
- **Fully safe to build now** — it's read-only reporting. This is the recommended
  **first buildable piece** of the engine: `tools/check-updates.mjs` → writes rows
  + prints a table. No autonomy, high value.

### C3 — Environment feedback loop (`apply`, gated)
- Takes an **approved** `improvement` and applies it through a safe channel:
  - `module-enhance` → a branch + PR in the relevant repo (life-os / a project).
  - `tool-update` → the actual upgrade command, shown and confirmed first.
  - `env-change` (`~/.zshrc`, Claude `settings.json`, an MCP config, an Obsidian
    template, a NotebookLM notebook) → a **diff you approve**, then written by the
    bridge (it already owns filesystem + browser-automation duties).
- Company projects / others' spaces: **draft-only**, never auto-pushed
  (confirm-before-others-edits).

---

## 5. Phasing

| Phase | Piece | Autonomy | Size |
|---|---|---|---|
| 1 | C2 update radar (`check-updates.mjs`, read-only report + rows) | none | S |
| 2 | C1 Coach panel (rules-only dead-end/empty-field scan) | none | S |
| 3 | `improvements` table + inbox UI (approve/dismiss) | none | M |
| 4 | C1 LLM proposals via the bridge + Claude | suggest-only | M |
| 5 | C3 apply-with-gate (PR / diff / confirmed command) | **gated** | L |

Phases 1–2 need **no** new architecture and don't touch the concurrent
knowledge-platform files — buildable immediately. Phase 3+ rides on that work's
bridge + W4 IDs.

---

## 6. Open decisions (need your call before Phase 4/5)

1. **How much history?** Start with table-shape signals only, or add per-action
   event logging (a `usage_events` table)? Event logging is more powerful but adds
   write overhead everywhere.
2. **Apply blast radius** — allow `env-change` to touch Claude `settings.json` /
   `~/.zshrc` (powerful, higher risk), or keep C3 to repo PRs only at first?
3. **Cadence** — update radar on-demand, or a scheduled daily run (cron/LaunchAgent)?
4. **Company scope** — engine reads company projects for suggestions, but any
   change there is draft-only. Confirm that boundary.
