import { getClient, cloudEnabled } from '../db.js';

/* Read-only view of AI-generated study materials, joined to their learning
 * item's title/date via the learning_session_id foreign key. */
export const MaterialsRepo = {
  cloudEnabled,

  async list() {
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c
      .from('learning_materials')
      .select('id, model, content, created_at, learning_sessions(title, learned_on)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      model: r.model,
      title: r.learning_sessions?.title || 'Untitled',
      learnedOn: r.learning_sessions?.learned_on || null,
      guide: r.content?.guide || '',
      flashcards: Array.isArray(r.content?.flashcards) ? r.content.flashcards : [],
      quiz: Array.isArray(r.content?.quiz) ? r.content.quiz : [],
    }));
  },
};
