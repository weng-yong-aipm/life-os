/* The 13-week execution plan, W1–W13, 2026-08-04 → 2026-11-02.
 *
 * This repo is public. Titles, tasks and notes are deliberately generic: no employer,
 * no target companies, no salary figures, no probabilities. The private plan holds all
 * of that. Anything here should be safe for a stranger to read.
 *
 * `owner` is either 'me' (only Weng can do it — an account, a person, a conversation)
 * or 'build' (engineering work that can be delegated or done at a desk). The split
 * matters: the plan has repeatedly stalled on 'me' items while 'build' items raced ahead.
 */

export const WEEKS = [
  {
    week: 1,
    start: '2026-08-04',
    end: '2026-08-10',
    theme: 'Ship the artifact, open the two channels',
    gate: 'The artifact is public and a stranger can reproduce it in three commands.',
    tasks: [
      { id: 'w1-artifact', owner: 'build', text: 'Publish the agent + eval suite, results page live', done: true },
      { id: 'w1-readme', owner: 'build', text: 'README leads with results and a 3-command repro', done: true },
      { id: 'w1-stats', owner: 'build', text: 'Confidence intervals on every rate; withhold overlapping claims', done: true },
      { id: 'w1-ask', owner: 'me', text: 'Ask manager for named ownership of the eval layer — in writing', done: false },
      { id: 'w1-linkedin', owner: 'me', text: 'Rebuild profile headline + about; Open-to-Work set to recruiters-only', done: false },
      { id: 'w1-outreach', owner: 'me', text: 'Send the first 5 outreach messages asking for a reproduction', done: false },
    ],
  },
  {
    week: 2,
    start: '2026-08-11',
    end: '2026-08-17',
    theme: 'Targets named, context engineering',
    gate: 'Twelve named roles with a real URL and a real person each.',
    tasks: [
      { id: 'w2-targets', owner: 'me', text: 'Build the 12-row target table: URL, band, entity country, named human', done: false },
      { id: 'w2-outreach', owner: 'me', text: '10 more outreach messages (15 cumulative)', done: false },
      { id: 'w2-context', owner: 'build', text: 'Context engineering: compaction, external notes, just-in-time retrieval', done: false },
      { id: 'w2-answer', owner: 'me', text: 'Record the written yes/no from the manager', done: false },
    ],
  },
  {
    week: 3,
    start: '2026-08-18',
    end: '2026-08-24',
    theme: 'First applications, judge calibrated',
    gate: 'Four applications sent. Judge agreement with own labels ≥ 80%.',
    tasks: [
      { id: 'w3-apply', owner: 'me', text: 'First 4 applications, highest tier first, no cover letters', done: false },
      { id: 'w3-judge', owner: 'build', text: 'LLM judge for handoff-packet quality, calibrated to ≥80% agreement', done: false },
      { id: 'w3-outreach', owner: 'me', text: '5 more outreach (20 cumulative)', done: false },
      { id: 'w3-numbers', owner: 'me', text: 'Pull the six production numbers and rehearse them out loud', done: false },
    ],
  },
  {
    week: 4,
    start: '2026-08-25',
    end: '2026-08-31',
    theme: 'Make the gate go red',
    gate: 'A deliberately broken PR produces a red CI run whose URL is on the results page.',
    tasks: [
      { id: 'w4-red', owner: 'build', text: 'Break a grader on a PR, capture the red run URL, fix it green', done: false },
      { id: 'w4-cases', owner: 'build', text: 'Grow escalation-positive cases from 20 to 35 for a ±0.10 interval', done: false },
      { id: 'w4-repro', owner: 'me', text: 'Chase replies; convert one into a confirmed reproduction', done: false },
    ],
  },
  {
    week: 5,
    start: '2026-09-01',
    end: '2026-09-07',
    theme: 'Cost discipline',
    gate: 'Prompt-cache hit rate is a number you can say without looking it up.',
    tasks: [
      { id: 'w5-cache', owner: 'build', text: 'Log cache counters; audit the prefix for silent invalidators', done: false },
      { id: 'w5-apply', owner: 'me', text: '4 more applications (8 cumulative)', done: false },
    ],
  },
  {
    week: 6,
    start: '2026-09-08',
    end: '2026-09-14',
    theme: 'First stranger',
    gate: 'One person who is not you has run it and reported a number.',
    tasks: [
      { id: 'w6-stranger1', owner: 'me', text: 'First confirmed reproduction by a stranger — screenshot it', done: false },
      { id: 'w6-deploy', owner: 'build', text: 'Deploy to a machine you do not own; survive a reboot with state intact', done: false },
    ],
  },
  {
    week: 7,
    start: '2026-09-15',
    end: '2026-09-21',
    theme: 'Second stranger',
    gate: 'Two independent reproductions. The binding constraint is closed.',
    tasks: [
      { id: 'w7-stranger2', owner: 'me', text: 'Second confirmed reproduction', done: false },
      { id: 'w7-apply', owner: 'me', text: '4 more applications (12 cumulative)', done: false },
      { id: 'w7-page', owner: 'build', text: 'Put both reproductions on the results page with dates', done: false },
    ],
  },
  {
    week: 8,
    start: '2026-09-22',
    end: '2026-09-28',
    theme: 'Observability',
    gate: 'You can name the span types and point at them in the trace.',
    tasks: [
      { id: 'w8-otel', owner: 'build', text: 'Structured traces with standard GenAI span naming', done: false },
      { id: 'w8-sample', owner: 'me', text: 'Weekly scored sample running on the work instance', done: false },
    ],
  },
  {
    week: 9,
    start: '2026-09-29',
    end: '2026-10-05',
    theme: 'Security, stated as an argument',
    gate: 'One leg of the lethal trifecta is cut in code, with a test proving it.',
    tasks: [
      { id: 'w9-sec', owner: 'build', text: 'Security writeup, residual risks named honestly', done: true },
      { id: 'w9-apply', owner: 'me', text: '4 more applications (16 cumulative)', done: false },
    ],
  },
  {
    week: 10,
    start: '2026-10-06',
    end: '2026-10-12',
    theme: 'Maintenance only — add no features',
    gate: 'Every new eval case traces to a real failure someone reported.',
    tasks: [
      { id: 'w10-triage', owner: 'build', text: 'Fix what users report; promote each failure into the suite', done: false },
      { id: 'w10-dm', owner: 'me', text: 'One direct message to a named person at a top-tier target', done: false },
    ],
  },
  {
    week: 11,
    start: '2026-10-13',
    end: '2026-10-19',
    theme: 'The postmortem',
    gate: 'A published postmortem of a failure that happened while someone depended on it.',
    tasks: [
      { id: 'w11-pm', owner: 'build', text: 'Write it: timestamp, blast radius, detection, fix commit, case added', done: false },
      { id: 'w11-nofake', owner: 'me', text: 'If no incident has occurred, do NOT invent one — defer to W13', done: false },
    ],
  },
  {
    week: 12,
    start: '2026-10-20',
    end: '2026-10-26',
    theme: 'Interview surface',
    gate: 'Four answers under 200 words each, rehearsed out loud.',
    tasks: [
      { id: 'w12-verify', owner: 'build', text: 'Verify the second-user milestone with a query, screenshot it', done: false },
      { id: 'w12-stories', owner: 'me', text: 'Three diagnosis stories in market vocabulary, not ticket narratives', done: false },
      { id: 'w12-restraint', owner: 'me', text: 'The restraint answer: three places you chose rules over a model', done: false },
      { id: 'w12-build', owner: 'me', text: 'One timed 45-minute live-build practice round', done: false },
    ],
  },
  {
    week: 13,
    start: '2026-10-27',
    end: '2026-11-02',
    theme: 'Scoreboard and branch',
    gate: 'A dated page: N applications, N replies, N screens — and the next 90 days named.',
    tasks: [
      { id: 'w13-count', owner: 'me', text: 'Count applications, replies, screens reached. Honestly.', done: false },
      { id: 'w13-freeze', owner: 'build', text: 'Tag v1.0 and freeze scope; new ideas go to a backlog file', done: false },
      { id: 'w13-branch', owner: 'me', text: 'Re-answer the relocation question with 13 weeks of evidence', done: false },
      { id: 'w13-charter', owner: 'me', text: 'Turn the work claim into a one-page charter your manager has read', done: false },
    ],
  },
];

/* The five things that must be true on 2026-11-02 for the quarter to have worked.
 * Deliberately not "get an offer" — search-to-offer latency is longer than 90 days. */
export const QUARTER_GATES = [
  'Relocation decision made and written down',
  'Public profile rebuilt and searchable',
  '16 applications in flight',
  'Two strangers have reproduced the artifact',
  'One CI regression caught and linked publicly',
];
