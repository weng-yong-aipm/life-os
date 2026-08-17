# Memory entry lifecycle + broken-reference detector

**Date:** 2026-08-17
**Status:** design approved, not yet implemented
**Sub-project 1 of 5** (see *Follow-on work* at the end)

## The problem, measured

The knowledge base that already feeds every Claude Code session is
`~/.claude/projects/-Users-wengyong/memory/` — 286 entries, 1,550,739 characters, indexed by a
57-line `MEMORY.md` that is injected at the start of every session.

Nothing checks whether an entry is still true. Measured 2026-08-17:

- Entries reference **565 distinct file paths**.
- **88** of them do not exist in AI-chatops.
- Of a 6-path sample, **2 were false alarms** — they exist, in `cs-flow-builder`, not AI-chatops.
  The other 4 are genuinely gone from every repo root checked (e.g. `scripts/daily-report.mjs`,
  whose real successor is the cross-platform market brief).

So stale entries are being injected into every session today, and a naive detector that resolves
paths against a single repo would cry wolf about a third of what it flags.

The corpus figure matters for a second reason: 1.55M characters is roughly 400–500k tokens. The
"it all fits in one window" argument recorded on 2026-08-16 was measured against the Obsidian
vault (263k 字), not against this corpus. Only `MEMORY.md` plus recalled entries are injected, so
nothing is broken today — but "just load everything" is not available here as a fallback.

## What this sub-project does, and does not

**Does:** decide, with evidence, which existing entries no longer hold; propose them for
retirement; on approval, mark them retired without deleting anything.

**Does not:** read session transcripts, count usage frequency, post a weekly card, touch
Supabase, build a vector store, or create a new Obsidian sync path. Each of those is a separate
sub-project with its own spec.

## Decisions

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Store | Extend the existing `memory/` corpus; Obsidian is a rendered **view**, not the source | A second store in Obsidian would create two sources of truth for the same knowledge, and Obsidian has no injection path today — nothing reads it back |
| Reader | The next Claude Code session | Bot modules would need a machine-readable interface and per-module retrofits for a consumer that does not exist yet |
| Code location | `~/life-os` (personal) | AI-chatops is the company repo; this scans a corpus containing career and salary entries. Requires an explicit, project-scoped exception to the standing "only edit AI-chatops" rule — granted 2026-08-17 |
| Approval surface | A local markdown report file | The existing life-os `improvements` inbox is a Supabase table; entry slugs (including career ones) would leave the machine. Obsidian has no write-back path |
| Retirement triggers | Broken reference (this sub-project), contradiction and long-unreferenced (later sub-projects) | All three were requested; only the first is deterministic and needs no new sensor |

Retirement always **proposes**. Nothing is retired without an explicit approval step, matching the
standing rule that self-learning proposes rather than auto-applies.

## Architecture

Four units. Each does one thing and is testable alone.

### `tools/memory-lifecycle.mjs` — the schema

The only code that reads or writes lifecycle frontmatter. Fields added to an entry:

```yaml
status: active | retired      # absent means active — 286 existing entries need no migration
retired_at: 2026-08-17        # ISO date, set only on retirement
retired_reason: broken-reference | contradiction | unreferenced | manual
retired_evidence: |           # what was checked and what was found, verbatim
  scripts/daily-report.mjs — not found in any of 6 repo roots (checked 2026-08-17)
```

`retired_reason` is declared with all four values so later sub-projects do not have to migrate the
schema, but this sub-project only ever writes `broken-reference`. A `manual` value is written by
hand, never by these tools.

Absent `status` means active. This is deliberate: it makes the change additive, so no bulk
rewrite of 286 files is needed and an unmigrated entry behaves exactly as it does now.

### `tools/memory-references.mjs` — extract and resolve

Extracts references from an entry body and resolves each one. Reference kinds, in the order they
were observed in the real corpus:

- **file paths** — `src/…`, `scripts/…`, `docs/…`, `cockpit-react/…`
- **npm scripts and CLI commands** — `node scripts/x.mjs`, `npm run y`
- **env flags** — `RELEASE_ENABLED`, `MEEGLE_READONLY`
- **git branches** — `feat/…`, `work/…`

Each resolves to `alive`, `missing`, `ambiguous`, or `tail` against a **root map**:

```
~/AI-chatops  ~/life-os  ~/cs-flow-builder  ~/chatbot  ~/PersonalNotes  ~/Documents/DevNotes
```

`ambiguous` means the same relative path exists under more than one root. Ambiguous is **not**
evidence of rot and never contributes to a nomination.

`tail` means the path as written is not found, but a real file's trailing segments match it — the
entry wrote `src/api.js` for `cockpit-react/src/api.js`, or `config/env.js` for
`src/config/env.js`. The file exists and the entry's claim may well still hold; only its path is
imprecise. These are listed separately as paths worth tidying, never nominated.

The root map is the load-bearing part of this sub-project, not a configuration detail.

**Amended 2026-08-17, after running the extractor against the live corpus** (the numbers in the
opening section came from a cruder grep; these supersede them): 789 references extracted, **111**
dead when resolved against AI-chatops alone, **66** unique still dead against all six roots, **7**
of those tail matches, leaving **59** genuinely dead. The naive single-root detector overstates rot
by 47%. Two weeks of a report that wrong and nobody reads it — which is the failure mode where a
governance list becomes the new blind spot.

### `tools/scan-memory-rot.mjs` — the report

Runs the resolver across every entry and writes a nomination report to
`~/life-os/docs/reports/memory-rot-<YYYY-MM-DD>.md` — inside life-os, so the report is versioned
alongside the tool, and dated, so an older run is never silently overwritten by a newer one.
**Writes nothing else** — it never touches an entry file. Report contents per nomination: entry
name, each dead reference, which roots were searched, and the date checked.

The report is also the approval surface: delete the lines you disagree with, then run the applier.

### `tools/apply-retirement.mjs` — the only writer

Consumes an approved report. Sets the lifecycle fields on each named entry and moves that entry's
line in `MEMORY.md` into a `## 已淘汰` section, creating that section at the end of the file if it
is absent — `MEMORY.md` is a flat list of `- ` lines today with no headings at all, so the first
retirement introduces the only heading in the file. It never deletes a file, never deletes an
index line, and never edits an entry's body.

## Data flow

```
memory/*.md ────┐
                ├──→ scan-memory-rot.mjs (read-only) ──→ nomination report (.md)
6 repo roots ───┘                                              │
                                                    Weng deletes rows he rejects
                                                               ↓
                                             apply-retirement.mjs (only writer)
                                                               ↓
                                    entry frontmatter: status/retired_at/reason/evidence
                                    MEMORY.md: index line moved to 已淘汰, never removed
```

## Error handling

Each rule exists because its absence has already caused a real failure somewhere in this system.

- **A missing repo root aborts the whole run.** If `~/cs-flow-builder` is not mounted, every
  reference under it resolves as missing and the tool would nominate hundreds of entries at once.
  A root that cannot be found is a broken instrument, not a finding.
- **Unparseable frontmatter is reported and skipped.** The file is never rewritten. A partial
  parse must not become a partial write.
- **Zero nominations must be distinguishable from a scan that did not run.** The report always
  states how many entries were read and how many references were resolved. An empty report with
  no counts is treated as a failure, not a pass.
- **The applier refuses an entry it cannot re-verify.** If a nominated reference has come back to
  life between scan and apply, that row is skipped and reported rather than applied.

## Anti-rot: the retirement list must not become the blind spot

A retired entry whose dead references are **alive again** is flagged for re-review. Retirement is
reversible by design, so the list has to be checked in both directions — a stale `retired` marker
would otherwise hide a fact that has become true again, which is exactly how an exemption list
turns into the hole it was built to close.

`MEMORY.md` and entry status must not drift: an entry marked `retired` that still sits in the
active index, or an active entry listed under `已淘汰`, is an error.

## Testing

life-os runs `node --test "*/*.test.js"`; tests live beside the tools as `tools/*.test.js`.

Properties, each stated as the failure it prevents:

1. **An entry whose references resolve under a different root is not nominated.** This is the
   whole detector. Mutation check: remove the root map and this test must go red — if it stays
   green the test is decorative.
2. **Retirement never deletes and never edits a body.** The entry body is compared byte-for-byte
   before and after.
3. **A retired entry whose references came back is flagged.** Both directions of the list.
4. **A missing repo root aborts instead of mass-nominating.** Point the map at a nonexistent
   directory; the run must fail, not produce a large report.
5. **Unparseable frontmatter leaves the file untouched** and appears in the report.
6. **Zero nominations is distinguishable from a scan that did not run** — counts are asserted, not
   just the empty list.
7. **`MEMORY.md` and entry status cannot drift** — a retired entry still in the active index fails.

## Acceptance, on real data

Fixtures prove the logic; only the real corpus proves the tool. Acceptance is a run against the
live 286 entries with:

- The raw single-root count (88 dead references) and the post-root-map count both reported. The
  reduction is stated as a number, not as "fewer false positives".
- A hand-checked sample confirming that the two `cs-flow-builder` paths are **not** nominated, and
  that a sample of nominated entries really are dead in every root.
- No entry file modified by the scan — verified by git status on the corpus, not by inspection.

## What this tool cannot see

Stated here so the tool is not mistaken for more than it is:

- It checks whether a reference **exists**, not whether the surrounding claim is still **true**.
  An entry can name a file that still exists while everything it says about that file is wrong.
- It cannot judge entries that reference nothing concrete — advice, preferences, and conclusions
  have no anchor to check. Those are the contradiction and unreferenced detectors, later.
- Renames read as deletions. `scripts/daily-report.mjs` → the market brief is a rename, and the
  tool reports it as missing without knowing the successor exists.

## Follow-on work (not designed here)

2. **Session adoption** — read Claude Code transcripts, nominate sessions worth keeping. Blocked
   on a redaction rule: transcripts contain secrets (a Bearer token appeared in tool output during
   the 2026-08-17 session).
3. **Usage sensor repair** — `module_usage` covers 10 of 68 modules and has recorded nothing since
   2026-07-16; the Lark `usageLog` table holds 3 rows. `logs/ai-usage.jsonl` is live (1,252 rows,
   404 labels) but records only LLM calls.
4. **Weekly review card** — needs 2 and 3 first. A weekly report built on today's sensors would
   confidently describe a month-old slice of 15% of the modules.
5. **Networked store** — company-network Obsidian, MongoDB, or a vector store. Explicitly deferred.
