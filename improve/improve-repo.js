import { getClient, cloudEnabled } from '../db.js';

function toRow(r) {
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    target: r.target,
    title: r.title,
    detail: r.detail,
    status: r.status,
    createdAt: r.created_at,
  };
}

async function requireUser(c) {
  const { data: { user } } = await c.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  return user;
}

export const ImproveRepo = {
  cloudEnabled,

  async list() {
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c
      .from('improvements')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(toRow);
  },

  /** Idempotent by (source, source_key): re-scanning won't duplicate open suggestions. */
  async upsert(suggestions) {
    const c = await getClient();
    if (!c) throw new Error('Improvements need cloud sync — enable Supabase in config.js.');
    const user = await requireUser(c);
    const rows = suggestions.map((s) => ({
      user_id: user.id,
      source: s.source,
      source_key: s.sourceKey ?? null,
      kind: s.kind,
      target: s.target ?? null,
      title: s.title,
      detail: s.detail ?? null,
      evidence: s.evidence ?? null,
    }));
    const { data, error } = await c
      .from('improvements')
      .upsert(rows, { onConflict: 'user_id,source,source_key', ignoreDuplicates: true })
      .select();
    if (error) throw error;
    return { saved: (data ?? []).length };
  },

  async setStatus(id, status) {
    const c = await getClient();
    if (!c) throw new Error('Not signed in.');
    const patch = { status };
    if (status === 'applied') patch.applied_at = new Date().toISOString();
    const { error } = await c.from('improvements').update(patch).eq('id', id);
    if (error) throw error;
  },
};
