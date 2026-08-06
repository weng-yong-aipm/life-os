/* Pure Goals & Certs logic — no I/O. Categories, seed set, and progress rollups. */

export const CATEGORIES = ['role', 'income', 'cert', 'course', 'skill'];
export const STATUSES = ['planned', 'active', 'done'];

/* Retired 2026-08-06: FDE_STARTER, MILESTONE_TRACK and LEARNING_TRACK.
 *
 * Two reasons. They encoded a certification path (PMP, Scrum, NVIDIA, AWS) that two
 * successive assessments concluded should be dropped — no employer at the target band
 * checks for those. And their titles carried explicit income figures into a PUBLIC
 * repository that this owner's CV links to, which hands a counterparty the target band
 * before any conversation starts. The figures themselves stay in a private file.
 *
 * The live sets are AI_PM_RUBRIC (capabilities) and NINETY_DAY_TRACK (execution).
 * Prior versions remain in git history if ever needed. */

/* The AI-PM competency rubric distilled from the 可颂 收藏 clip (2026-07-29 抖音
 * review): the 5 capabilities a big-tech AI PM is hired on. Skills, prefixed so
 * they never collide with the other seeds. Seeded by "Seed AI-PM rubric". */
export const AI_PM_RUBRIC = [
  { title: 'PM: Structured requirement decomposition', category: 'skill', status: 'active', progress: 55 },
  { title: 'PM: Fast demoable MVP (idea → clickable)', category: 'skill', status: 'active', progress: 50 },
  { title: 'PM: Basic architecture literacy (spec to devs)', category: 'skill', status: 'active', progress: 45 },
  { title: 'PM: AI full-flow leverage (whole pipeline)', category: 'skill', status: 'active', progress: 60 },
  { title: 'PM: Judging AI-code boundaries (what to trust)', category: 'skill', status: 'active', progress: 50 },
];

/* The 90-day execution track (2026-08-05 plan): one checkpoint per week, W1–W13.
 * Titles and notes are deliberately generic — this repo is public, so no employer,
 * operator, or target-company names appear here. The private plan holds the detail. */
export const NINETY_DAY_TRACK = [
  { title: 'W1 · Branch answers written, profile rebuilt, repo scaffolded', category: 'role', status: 'planned', progress: 0, targetDate: '2026-08-10', note: 'Three decisions answered in one word each; public profile live; CI green on an empty repo.' },
  { title: 'W2 · Scope ask sent, 12 target roles listed, tool schemas written', category: 'role', status: 'planned', progress: 0, targetDate: '2026-08-17', note: 'The ask is in writing. Each target row has a URL, a band, an entity country and a named human.' },
  { title: 'W3 · Tool loop runs end to end, first 4 applications sent', category: 'skill', status: 'planned', progress: 0, targetDate: '2026-08-24', note: 'Recorded session shows a parallel call, an error, a recovery, and a clean stop.' },
  { title: 'W4 · 45 labelled eval cases, five termination layers tested', category: 'skill', status: 'planned', progress: 0, targetDate: '2026-08-31', note: 'Slowest week in the plan. Budget all of it for labelling and do not let it spill.' },
  { title: 'W5 · Code graders and three baselines diffed', category: 'skill', status: 'planned', progress: 0, targetDate: '2026-09-07', note: 'Without a baseline diff it is a demo, not a harness. 8 applications cumulative.' },
  { title: 'W6 · Deployed to a machine I do not own, first 2 operators', category: 'skill', status: 'planned', progress: 0, targetDate: '2026-09-14', note: 'Public HTTPS 200 from off-laptop; survives a reboot with state intact.' },
  { title: 'W7 · Trajectory graders, judge at 80% agreement, CI gate red-then-green', category: 'skill', status: 'planned', progress: 0, targetDate: '2026-09-21', note: 'The red CI run URL is the artifact. 12 applications cumulative.' },
  { title: 'W8 · Public results page passes the 30-second test', category: 'role', status: 'planned', progress: 0, targetDate: '2026-09-28', note: 'A stranger states what it decides, how well, and what it costs — without clicking anything.' },
  { title: 'W9 · Durable pause and resume, permissions, security writeup', category: 'skill', status: 'planned', progress: 0, targetDate: '2026-10-05', note: 'Over 2h pause across a process restart, no double-execution on resume. 3 operators.' },
  { title: 'W10 · Maintenance only; failures promoted into the suite', category: 'skill', status: 'planned', progress: 0, targetDate: '2026-10-12', note: 'Add no features. Case count grows from real reported failures only. 16 applications cumulative.' },
  { title: 'W11 · Incident postmortem published, weekly sample loop running', category: 'role', status: 'planned', progress: 0, targetDate: '2026-10-19', note: 'Do not fabricate an incident. If none has occurred, defer this to W13.' },
  { title: 'W12 · Second-user milestone verified, interview answers written', category: 'role', status: 'planned', progress: 0, targetDate: '2026-10-26', note: 'At least 3 distinct non-self actors, 100 sessions, 4 calendar weeks — screenshotted.' },
  { title: 'W13 · 90-day scoreboard and branch decision', category: 'income', status: 'planned', progress: 0, targetDate: '2026-11-02', note: 'Count applications, replies, screens. Re-answer the relocation question with 13 weeks of feedback.' },
];

/* Clamp a progress value to a whole 0..100. */
export function clampProgress(n) {
  const v = Math.round(Number(n) || 0);
  return Math.max(0, Math.min(100, v));
}

/* Roll goals up into an overview: totals, status counts, and per-category
 * completion. overallProgress is the mean of every goal's progress. */
export function summarize(goals) {
  const total = goals.length;
  const byStatus = { planned: 0, active: 0, done: 0 };
  const byCategory = {};
  let progressSum = 0;
  for (const g of goals) {
    const status = STATUSES.includes(g.status) ? g.status : 'planned';
    byStatus[status] += 1;
    const cat = CATEGORIES.includes(g.category) ? g.category : 'skill';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, done: 0 };
    byCategory[cat].total += 1;
    if (status === 'done') byCategory[cat].done += 1;
    progressSum += clampProgress(g.progress);
  }
  const overallProgress = total ? Math.round(progressSum / total) : 0;
  return { total, byStatus, byCategory, overallProgress };
}
