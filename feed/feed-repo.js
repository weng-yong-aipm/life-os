import { getClient, cloudEnabled } from '../db.js';

/* Feed items → same camelCase shape the pure feed.js logic expects. */
function toRow(r) {
  return {
    id: r.id,
    platform: r.platform,
    sourceHandle: r.source_handle,
    sourceName: r.source_name,
    externalId: r.external_id,
    url: r.url,
    title: r.title,
    publishedAt: r.published_at,
    fetchedAt: r.fetched_at,
    summary: r.summary,
    topics: r.topics || [],
    durationSec: r.duration_sec,
    status: r.status,
    promotedLearningId: r.promoted_learning_id,
  };
}

/* feed platform → learning_sessions.source (that column only knows
 * douyin | instagram | other). */
function learningSource(platform) {
  if (platform === 'douyin') return 'douyin';
  if (platform === 'instagram') return 'instagram';
  return 'other';
}

async function requireUser(c) {
  const { data: { user } } = await c.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  return user;
}

export const FeedRepo = {
  cloudEnabled,

  async list() {
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c
      .from('feed_items')
      .select('*')
      .order('fetched_at', { ascending: false });
    if (error) throw error;
    return data.map(toRow);
  },

  /* Triage. 'applied' / 'considering' also copy the item into the learning log
   * once (guarded by promoted_learning_id); 'rejected' / 'new' just set status. */
  async setStatus(item, status) {
    const c = await getClient();
    if (!c) throw new Error('Feed needs cloud sync — enable Supabase in config.js.');
    const user = await requireUser(c);

    const fields = { status };
    const shouldPromote = (status === 'applied' || status === 'considering') && !item.promotedLearningId;
    if (shouldPromote) {
      const { data: learn, error: lerr } = await c
        .from('learning_sessions')
        .insert({
          user_id: user.id,
          learned_on: new Date().toISOString().slice(0, 10),
          source: learningSource(item.platform),
          link: item.url || null,
          title: item.title,
          summary: item.summary || null,
          verdict: status,
          tags: (item.topics && item.topics.length) ? item.topics : null,
        })
        .select()
        .single();
      if (lerr) throw lerr;
      fields.promoted_learning_id = learn.id;
    }

    const { data, error } = await c
      .from('feed_items')
      .update(fields)
      .eq('id', item.id)
      .select()
      .single();
    if (error) throw error;
    return toRow(data);
  },

  async remove(id) {
    const c = await getClient();
    if (!c) throw new Error('Not signed in.');
    const { error } = await c.from('feed_items').delete().eq('id', id);
    if (error) throw error;
  },
};
