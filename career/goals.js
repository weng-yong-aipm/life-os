/* Pure Goals & Certs logic — no I/O. Categories, seed set, and progress rollups. */

export const CATEGORIES = ['role', 'income', 'cert', 'course', 'skill'];
export const STATUSES = ['planned', 'active', 'done'];

/* Starter set: the FDE / $20k target, certs, courses, and the FDE competency
 * skill map (from the 天道 FDE breakdown). Used by the "Seed FDE track" button. */
export const FDE_STARTER = [
  { title: 'Become a Forward Deployed Engineer (FDE)', category: 'role', status: 'active', progress: 20 },
  { title: 'Land a ~$20k USD/mo remote role', category: 'income', status: 'active', progress: 10 },
  { title: 'PMP', category: 'cert', status: 'planned', progress: 0 },
  { title: 'Scrum / Agile (PSM)', category: 'cert', status: 'planned', progress: 0 },
  { title: 'Claude Code Architect', category: 'cert', status: 'planned', progress: 0 },
  { title: 'NVIDIA (AI / Deep Learning)', category: 'cert', status: 'planned', progress: 0 },
  { title: 'AI Essentials', category: 'course', status: 'planned', progress: 0 },
  { title: 'AI Fundamentals', category: 'course', status: 'planned', progress: 0 },
  { title: 'LLMs / 大模型', category: 'skill', status: 'active', progress: 60 },
  { title: 'RAG', category: 'skill', status: 'active', progress: 55 },
  { title: 'Agent engineering / Agent 工程', category: 'skill', status: 'active', progress: 65 },
  { title: 'API integration', category: 'skill', status: 'active', progress: 70 },
  { title: 'Data pipelines / 数据处理', category: 'skill', status: 'active', progress: 45 },
  { title: 'Systems integration / 系统集成', category: 'skill', status: 'planned', progress: 30 },
];

/* The laddered career roadmap (Malaysia → $20k/mo AI PM + FDE) as trackable
 * milestones + income rungs. Seeded by the "Seed career ladder" button. */
export const MILESTONE_TRACK = [
  { title: 'P0 · Publish 2–3 public AI portfolio artifacts', category: 'role', status: 'active', progress: 25 },
  { title: 'P0 · US-market resume + LinkedIn (AI PM / FDE)', category: 'role', status: 'planned', progress: 0 },
  { title: 'P0 · First paid remote gig ($2–4k/mo)', category: 'income', status: 'planned', progress: 0 },
  { title: 'P1 · Master agentic orchestration + evals + observability', category: 'skill', status: 'active', progress: 50 },
  { title: 'P1 · Build in public — weekly AI PM/FDE posts', category: 'role', status: 'planned', progress: 0 },
  { title: 'P1 · Steady remote contract ($5–8k/mo)', category: 'income', status: 'planned', progress: 0 },
  { title: 'P2 · Land a location-agnostic AI PM / FDE role', category: 'role', status: 'planned', progress: 0 },
  { title: 'P2 · Income $8–14k/mo', category: 'income', status: 'planned', progress: 0 },
  { title: 'P3 · Senior seat or fractional consulting', category: 'role', status: 'planned', progress: 0 },
  { title: 'P3 · Reach $20k USD/mo ($240k/yr)', category: 'income', status: 'planned', progress: 0 },
];

/* The actionable learning track from the brutal plan: the 4 real skill gaps +
 * the priority certs (S/A tier), distinct from the competency seed. Titles are
 * prefixed so they never collide with FDE_STARTER on re-seed. */
export const LEARNING_TRACK = [
  { title: 'Learn: Python for AI/ML (Kaggle → DeepLearning.AI)', category: 'skill', status: 'active', progress: 20 },
  { title: 'Learn: Framework vocabulary (LangGraph/CrewAI/Ragas/LangSmith)', category: 'skill', status: 'active', progress: 40 },
  { title: 'Learn: Cloud + deploy (AWS, Docker/K8s)', category: 'skill', status: 'planned', progress: 15 },
  { title: 'Learn: Public technical writing (weekly posts)', category: 'skill', status: 'planned', progress: 5 },
  { title: 'Cert: Anthropic AI Fluency (4h — do first)', category: 'cert', status: 'active', progress: 0 },
  { title: 'Cert: AWS Cloud Practitioner → ML', category: 'cert', status: 'planned', progress: 0 },
  { title: 'Cert: NVIDIA DLI — RAG Agents', category: 'cert', status: 'planned', progress: 0 },
  { title: 'Cert: DeepLearning.AI — Agents/RAG', category: 'cert', status: 'planned', progress: 0 },
];

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
