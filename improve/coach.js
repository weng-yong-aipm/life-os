// Coach — rules-only scan (self-improvement engine, Phase 2 / C1). Given plain
// snapshots of the modules' rows, returns concrete improvement suggestions. Pure +
// deterministic (no LLM, no I/O) so it's unit-testable and free to run. Each
// suggestion carries a stable `sourceKey` so re-scanning is idempotent against the
// improvements inbox (upsert on conflict).

const lc = (s) => (s ?? '').toString().trim().toLowerCase();
const relates = (a, b) => a && b && (a.includes(b) || b.includes(a));

export const RULES = ['feed-backlog', 'applied-without-goal', 'stalled-goal', 'learning-missing-summary'];

/** snap = { feed: [...], learnings: [...], goals: [...] } — arrays of module rows. */
export function scan(snap = {}) {
  const feed = snap.feed ?? [];
  const learnings = snap.learnings ?? [];
  const goals = snap.goals ?? [];
  const out = [];

  // 1. Feed backlog — untriaged items piling up.
  const newFeed = feed.filter((f) => (f.status ?? 'new') === 'new').length;
  if (newFeed >= 10) out.push({
    source: 'coach', sourceKey: 'feed-backlog:feed', kind: 'module-enhance', target: 'feed',
    title: `Triage your feed — ${newFeed} items waiting`,
    detail: `${newFeed} feed items are still 'new'. Triage into applied/considering so they flow into Learning.`,
    evidence: { newFeed },
  });

  // 2. Applied learnings whose project matches no goal (pipeline gap).
  const goalNames = goals.map((g) => lc(g.title)).filter(Boolean);
  const orphans = learnings.filter((l) =>
    l.verdict === 'applied' && lc(l.project) &&
    !goalNames.some((n) => relates(n, lc(l.project))));
  if (orphans.length) out.push({
    source: 'coach', sourceKey: 'applied-without-goal:learning', kind: 'module-enhance', target: 'learning',
    title: `${orphans.length} applied learning(s) not linked to any goal`,
    detail: `Their "Applies to project" matches no career goal — create or rename a goal so Learning→Goals connects.`,
    evidence: { titles: orphans.slice(0, 8).map((l) => l.title) },
  });

  // 3. Stalled goals — active, 0%, and no applied learning feeding them.
  const fedProjects = learnings.filter((l) => l.verdict === 'applied').map((l) => lc(l.project)).filter(Boolean);
  const stalled = goals.filter((g) =>
    g.status === 'active' && (Number(g.progress) || 0) === 0 &&
    !fedProjects.some((p) => relates(lc(g.title), p)));
  if (stalled.length) out.push({
    source: 'coach', sourceKey: 'stalled-goal:career', kind: 'module-enhance', target: 'career',
    title: `${stalled.length} active goal(s) at 0% with nothing feeding them`,
    detail: `Log a learning against these or break them into smaller milestones.`,
    evidence: { goals: stalled.slice(0, 8).map((g) => g.title) },
  });

  // 4. Thin capture — learnings with no summary.
  const noSummary = learnings.filter((l) => !lc(l.summary)).length;
  if (noSummary >= 5) out.push({
    source: 'coach', sourceKey: 'learning-missing-summary:learning', kind: 'module-enhance', target: 'learning',
    title: `${noSummary} learning(s) have no summary`,
    detail: `Add a one-line "what you learned" so weekly digests and goal-linking stay useful.`,
    evidence: { noSummary },
  });

  return out;
}
