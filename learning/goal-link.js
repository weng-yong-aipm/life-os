// Learning → Goals connector — completes the learning-os pipeline
// (Feed → triage → Learning → **Goals**). Pure, deterministic logic so it's
// unit-testable and forward-compatible: today it links via a learning's free-text
// `project` field; when the knowledge-platform W-series lands structured
// source_key links, only this file's matcher changes.

const norm = (s) => (s ?? '').toString().trim().toLowerCase();

/** Does an applied learning support this goal?
 *  Match the learning's `project` text against the goal's title or category. */
export function supportsGoal(learning, goal) {
  const p = norm(learning.project);
  if (!p) return false;
  const title = norm(goal.title);
  const cat = norm(goal.category);
  return (title && (title.includes(p) || p.includes(title))) || p === cat;
}

/** Suggested new progress for a goal given how many applied learnings support it.
 *  +5 each, capped at +25 per pass and never past 95 from learnings alone
 *  (finishing a goal stays a deliberate human act). */
export function progressSuggestion(goal, supportingCount) {
  const cur = Number(goal?.progress) || 0;
  const bump = Math.min(25, Math.max(0, supportingCount) * 5);
  return Math.min(95, cur + bump);
}

/** Group APPLIED learnings under the goals they support.
 *  Returns one entry per goal with ≥1 supporting applied learning. */
export function linkAppliedToGoals(learnings, goals) {
  const applied = (learnings ?? []).filter((l) => l.verdict === 'applied');
  return (goals ?? [])
    .map((goal) => {
      const supporting = applied.filter((l) => supportsGoal(l, goal));
      return {
        goal,
        learnings: supporting,
        count: supporting.length,
        suggestedProgress: progressSuggestion(goal, supporting.length),
      };
    })
    .filter((e) => e.count > 0);
}
