import { getClient, cloudEnabled } from '../db.js';
import { clampProgress } from './goals.js';

function toRow(g) {
  return {
    id: g.id,
    title: g.title,
    category: g.category,
    status: g.status,
    progress: Number(g.progress) || 0,
    targetDate: g.target_date,
    note: g.note,
  };
}

function toInsert(userId, g) {
  return {
    user_id: userId,
    title: g.title,
    category: g.category || 'skill',
    status: g.status || 'planned',
    progress: clampProgress(g.progress),
    target_date: g.targetDate || null,
    note: g.note || null,
  };
}

async function requireUser(c) {
  const { data: { user } } = await c.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  return user;
}

export const GoalsRepo = {
  cloudEnabled,

  async add(goals) {
    const c = await getClient();
    if (!c) throw new Error('Goals need cloud sync — enable Supabase in config.js.');
    const user = await requireUser(c);
    const list = Array.isArray(goals) ? goals : [goals];
    const { data, error } = await c
      .from('career_goals')
      .insert(list.map((g) => toInsert(user.id, g)))
      .select();
    if (error) throw error;
    return data.map(toRow);
  },

  async list() {
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c
      .from('career_goals')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data.map(toRow);
  },

  async update(id, patch) {
    const c = await getClient();
    if (!c) throw new Error('Not connected.');
    const fields = {};
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.progress !== undefined) fields.progress = clampProgress(patch.progress);
    if (patch.targetDate !== undefined) fields.target_date = patch.targetDate || null;
    if (patch.note !== undefined) fields.note = patch.note || null;
    const { data, error } = await c.from('career_goals').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return toRow(data);
  },

  async remove(id) {
    const c = await getClient();
    if (!c) throw new Error('Not connected.');
    const { error } = await c.from('career_goals').delete().eq('id', id);
    if (error) throw error;
  },
};
