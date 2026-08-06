import { getClient } from '../db.js';
import { demoMode, fixtures } from '../demo.js';

function localId() {
  return globalThis.crypto?.randomUUID?.() || 'm_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toRow(m) {
  return {
    id: m.id, eatenAt: m.eaten_at, name: m.name, source: m.source,
    imagePath: m.image_path,
    calories: m.calories, proteinG: m.protein_g, carbsG: m.carbs_g, fatG: m.fat_g,
  };
}

export const MealsRepo = {
  async estimatePhoto(file) {
    const c = await getClient();
    if (!c) throw new Error('Photo estimate needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const storagePath = `${user.id}/${localId()}.${ext}`;
    const { error: upErr } = await c.storage.from('meals').upload(storagePath, file, { contentType: file.type });
    if (upErr) throw upErr;
    const { data: { session } } = await c.auth.getSession();
    const { data, error } = await c.functions.invoke('estimate-meal', {
      body: { storagePath, mediaType: file.type },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) { const e = new Error(error.message || 'estimate-meal failed'); e.storagePath = storagePath; throw e; }
    return { storagePath, extracted: data };
  },

  async save({ eatenAt, name, source, imagePath, calories, proteinG, carbsG, fatG }) {
    const c = await getClient();
    if (!c) throw new Error('Meals need cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c.from('meals').insert({
      user_id: user.id, eaten_at: eatenAt, name, source: source || 'manual',
      image_path: imagePath || null,
      calories: calories ?? null, protein_g: proteinG ?? null, carbs_g: carbsG ?? null, fat_g: fatG ?? null,
    }).select().single();
    if (error) throw error;
    return toRow(data);
  },

  /* A short-lived signed URL for a private-bucket image. The meals bucket is
   * private, so a stored path is not directly fetchable — without this the
   * photo can be uploaded and linked but never displayed. Returns null rather
   * than throwing: a missing thumbnail must not break the day list. */
  async signedUrlFor(imagePath) {
    if (!imagePath) return null;
    const c = await getClient();
    if (!c) return null;
    const { data, error } = await c.storage.from('meals').createSignedUrl(imagePath, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  },

  async listForDay(date) {
    if (demoMode) return fixtures.meals.filter((m) => m.eatenOn === date);
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c.from('meals').select('*').eq('eaten_at', date).order('created_at', { ascending: true });
    if (error) throw error;
    return data.map(toRow);
  },
};
