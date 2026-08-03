import { getClient, cloudEnabled } from '../db.js';
import { demoMode, fixtures } from '../demo.js';

function toRow(s) {
  return {
    id: s.id,
    learnedOn: s.learned_on,
    source: s.source,
    link: s.link,
    title: s.title,
    summary: s.summary,
    project: s.project,
    verdict: s.verdict,
    appliedNote: s.applied_note,
    tags: s.tags || [],
  };
}

function toInsert(e, userId) {
  return {
    user_id: userId,
    learned_on: e.learnedOn,
    source: e.source || 'douyin',
    link: e.link || null,
    title: e.title,
    summary: e.summary || null,
    project: e.project || null,
    verdict: e.verdict || 'considering',
    applied_note: e.appliedNote || null,
    tags: Array.isArray(e.tags) && e.tags.length ? e.tags : null,
  };
}

export const LearningRepo = {
  cloudEnabled,

  /* Insert one or many entries (the paste-import path sends an array). */
  async add(entries) {
    const list = Array.isArray(entries) ? entries : [entries];
    const c = await getClient();
    if (!c) throw new Error('Learning log needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const rows = list
      .filter((e) => e && e.title && e.learnedOn)
      .map((e) => toInsert(e, user.id));
    if (!rows.length) throw new Error('No valid entries (each needs at least a title and a date).');
    const { data, error } = await c.from('learning_sessions').insert(rows).select();
    if (error) throw error;
    return data.map(toRow);
  },

  async list() {
    if (demoMode) return fixtures.learning;
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c
      .from('learning_sessions')
      .select('*')
      .order('learned_on', { ascending: false });
    if (error) throw error;
    return data.map(toRow);
  },

  async remove(id) {
    const c = await getClient();
    if (!c) throw new Error('Not signed in.');
    const { error } = await c.from('learning_sessions').delete().eq('id', id);
    if (error) throw error;
  },
};
