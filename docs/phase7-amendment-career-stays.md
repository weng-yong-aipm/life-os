# Amendment to Desk & Shelf Phase 7 — the career module stays on the Shelf

**Decided by Weng, 2026-08-03.** Recorded here because the spec lives in the private repo
(`second-brain/docs/superpowers/specs/2026-08-02-desk-and-shelf-design.md`) and this session was
asked to stay out of it. **Whoever owns second-brain should fold this into §7.**

## What changes

Phase 7 item 25 currently reads, in part:

> `rm -r life-os/{feed,improve,career,tools}` … migration dropping `feed_items`,
> `improvements`, `career_goals`, `learning_materials`; `shell.js` MODULES 7→5

Amended:

- **Keep** `life-os/career/` — do not `rm -r` it.
- **Keep** the `career_goals` table — remove it from the drop migration.
- `feed`, `improve`, `tools` still go, as does `shell.js` trimming — but the target is now
  **MODULES 8→6**, since `capture` was added in Phase 4 and `career` is staying.

Unaffected: `feed_items`, `improvements`, `learning_materials` still drop as specified.

## Why

The original justification for dropping it was Decision #3 — *"Learning only. No zeros, nothing
fake."* — and at the time `career_goals` had **0 rows**, so the module rendered an empty shell.
That premise no longer holds. As of 2026-08-03 the table holds **23 evidence-based rows**
(13 competencies, 7 milestones, 3 deprioritised certs) produced by the AI-PM/FDE assessment
(`wf_162e5ab3-29a`), scored against shipped work rather than self-declared.

Decision #3 also says Finance/Health/**Goals** *"appear automatically on their first row"* — so
keeping a now-populated Goals module is the decision the spec already made, and item 25 was
written against the empty-table state.

## Consequence for the boundary

`career_goals` stays on the **public plane**. It is currently the only module there holding a
frank self-assessment, so the row content matters:

- Progress numbers and competency names are fine to be public.
- The `note` field carries assessment reasoning that cites specific files and counts from
  **work systems**. Those rows live in Supabase under RLS and are not in this repo — but two
  rules follow from that. **(1)** Demo mode must render fixtures, never real rows, or the
  notes become public the moment the demo URL is shared. **(2)** Nothing in this repo's docs
  should quote them; this repo is public and doubles as job-search evidence, and a portfolio
  artifact that lists an employer's internals reads badly regardless of how harmless the
  detail is.

Seed rows are tagged and reversible:

```sql
DELETE FROM career_goals WHERE note LIKE '%wf_162e5ab3-29a%';
```

## Related

- Assessment artifact: https://claude.ai/code/artifact/ebcc1bcf-137d-4ec1-9421-8682c7474088
- The binding constraint it identified — *"nothing you have built has ever been operated by a
  second human, on hardware you do not own"* — is tracked as
  `P0 · Second user on a hosted deploy`.
