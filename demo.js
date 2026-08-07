/* Demo mode — lets someone see what life-os does in five seconds, with no
 * account and no credentials.
 *
 * The safety property is structural, not careful coding: when `demoMode` is
 * true, `getClient()` in db.js returns null, so the Supabase client is never
 * constructed and no network call to real data is possible. Repos fall back
 * to the fixtures below. Writes already throw on a null client, so demo mode
 * is read-only for free.
 *
 * Everything here is invented. No real row, note, or number appears in this
 * file — several real rows cite work systems, and this repo is public. */

import { localDateStr } from './shared/local-date.js';

/* Guarded so this module can be imported under Node — db.js imports it, and
 * db.js is reachable from the test tree. */
export const demoMode = typeof location !== 'undefined'
  && new URLSearchParams(location.search).has('demo');

const today = new Date();
const iso = (offsetDays = 0) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offsetDays);
  return localDateStr(d);
};

export const fixtures = {
  goals: [
    { id: 'd1', title: 'Comp: API integration', category: 'skill', status: 'active', progress: 76, note: 'Evidence-scored against shipped work rather than self-assessed.' },
    { id: 'd2', title: 'Comp: Integration under constraint', category: 'skill', status: 'active', progress: 68, note: null },
    { id: 'd3', title: 'Comp: Architecture & spec', category: 'skill', status: 'active', progress: 66, note: null },
    { id: 'd4', title: 'Comp: LLM engineering', category: 'skill', status: 'active', progress: 58, note: null },
    { id: 'd5', title: 'Comp: Agent engineering', category: 'skill', status: 'active', progress: 47, note: null },
    { id: 'd6', title: 'Comp: Deploy & operate', category: 'skill', status: 'active', progress: 25, note: 'The fixable half.' },
    { id: 'd7', title: 'P0 · Second user on a hosted deploy', category: 'role', status: 'active', progress: 0, note: 'The binding constraint.' },
    { id: 'd8', title: 'P0 · Public portfolio artifacts', category: 'role', status: 'active', progress: 0, note: null },
    { id: 'd9', title: 'Reach a senior remote seat', category: 'income', status: 'planned', progress: 0, note: null },
  ],

  learning: [
    { id: 'l1', learnedOn: iso(-1), source: 'douyin', link: null, title: 'Agent tool-call validation beyond schema', summary: 'Schema-valid does not mean action-correct — validate business semantics before the call.', project: 'chatops', verdict: 'applied', tags: ['agent'] },
    { id: 'l2', learnedOn: iso(-3), source: 'youtube', link: null, title: 'Prompt caching on stable prefixes', summary: 'Cache the system and evidence blocks; only the tail varies per call.', project: 'life-os', verdict: 'applied', tags: ['llm', 'cost'] },
    { id: 'l3', learnedOn: iso(-5), source: 'other', link: null, title: 'GraphRAG — when it is actually worth it', summary: 'Only when queries traverse relationships. Otherwise keyword retrieval wins on cost.', project: null, verdict: 'considering', tags: ['rag'] },
    { id: 'l4', learnedOn: iso(-8), source: 'douyin', link: null, title: 'Personal workbench patterns', summary: 'Left nav, right content plus progress. Rebuilt endlessly; the layout is not the hard part.', project: 'life-os', verdict: 'rejected', tags: ['ui'] },
  ],

  expenses: [
    { id: 'e1', spentAt: iso(-1), amount: 18.5, category: 'food', note: 'lunch' },
    { id: 'e2', spentAt: iso(-2), amount: 240, category: 'transport', note: 'monthly pass' },
    { id: 'e3', spentAt: iso(-4), amount: 62.9, category: 'groceries', note: null },
    { id: 'e4', spentAt: iso(-6), amount: 35, category: 'food', note: 'dinner' },
    { id: 'e5', spentAt: iso(-9), amount: 129, category: 'utilities', note: 'internet' },
  ],

  workHours: [
    { id: 'w1', workedOn: iso(-1), hours: 2.5, kind: 'weekday', note: 'release prep' },
    { id: 'w2', workedOn: iso(-3), hours: 4, kind: 'weekend', note: 'hotfix' },
    { id: 'w3', workedOn: iso(-8), hours: 3, kind: 'weekday', note: null },
  ],

  meals: [
    { id: 'm1', eatenOn: iso(0), name: 'Oats + banana', calories: 380, proteinG: 14, carbsG: 58, fatG: 8 },
    { id: 'm2', eatenOn: iso(0), name: 'Chicken rice', calories: 620, proteinG: 38, carbsG: 72, fatG: 16 },
    { id: 'm3', eatenOn: iso(0), name: 'Greek yogurt', calories: 150, proteinG: 15, carbsG: 9, fatG: 4 },
  ],

  workouts: [
    { id: 'k1', doneAt: iso(-1), exercise: 'run', durationMin: 32, caloriesBurned: 310 },
    { id: 'k2', doneAt: iso(-3), exercise: 'strength', durationMin: 45, caloriesBurned: 260 },
    { id: 'k3', doneAt: iso(-5), exercise: 'walk', durationMin: 50, caloriesBurned: 180 },
  ],

  sleep: [
    { id: 's1', sleptOn: iso(-1), bedAt: `${iso(-2)}T23:15:00.000Z`, wakeAt: `${iso(-1)}T07:05:00.000Z`, durationMin: 470, quality: 4, note: null, source: 'manual' },
    { id: 's2', sleptOn: iso(-2), bedAt: `${iso(-3)}T23:40:00.000Z`, wakeAt: `${iso(-2)}T06:50:00.000Z`, durationMin: 430, quality: 3, note: 'woke up once', source: 'manual' },
    { id: 's3', sleptOn: iso(-3), bedAt: `${iso(-4)}T22:50:00.000Z`, wakeAt: `${iso(-3)}T06:30:00.000Z`, durationMin: 460, quality: 4, note: null, source: 'manual' },
    { id: 's4', sleptOn: iso(-4), bedAt: `${iso(-5)}T00:10:00.000Z`, wakeAt: `${iso(-4)}T07:20:00.000Z`, durationMin: 430, quality: 3, note: null, source: 'manual' },
    { id: 's5', sleptOn: iso(-5), bedAt: `${iso(-6)}T23:00:00.000Z`, wakeAt: `${iso(-5)}T06:45:00.000Z`, durationMin: 465, quality: 5, note: 'felt great', source: 'manual' },
  ],
};

/* Built with DOM methods rather than innerHTML: location.pathname is
 * attacker-influenceable via a crafted link, and this banner renders before
 * anyone has signed in. */
export function demoBanner() {
  if (!demoMode) return;
  const el = document.createElement('div');
  el.id = 'demo-banner';
  el.append('Demo data — nothing here is real, and no account is needed. ');
  const exit = document.createElement('a');
  exit.href = location.pathname;
  exit.textContent = 'exit demo';
  el.append(exit);
  document.body.prepend(el);
}
