import { getClient } from '../db.js';

function toRow(w) {
  return {
    id: w.id, doneAt: w.done_at, exercise: w.exercise, category: w.category,
    sets: w.sets, reps: w.reps, weightKg: w.weight_kg, durationMin: w.duration_min,
    caloriesBurned: w.calories_burned,
  };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const WorkoutsRepo = {
  async save({ doneAt, exercise, category, sets, reps, weightKg, durationMin, caloriesBurned }) {
    const c = await getClient();
    if (!c) throw new Error('Workouts need cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c.from('workouts').insert({
      user_id: user.id, done_at: doneAt, exercise, category: category || null,
      sets: sets ?? null, reps: reps ?? null, weight_kg: weightKg ?? null,
      duration_min: durationMin ?? null, calories_burned: caloriesBurned ?? null,
    }).select().single();
    if (error) throw error;
    return toRow(data);
  },

  async listForWeek(startDate) {
    const c = await getClient();
    if (!c) return [];
    const end = addDays(startDate, 7);
    const { data, error } = await c.from('workouts').select('*')
      .gte('done_at', startDate).lt('done_at', end).order('done_at', { ascending: false });
    if (error) throw error;
    return data.map(toRow);
  },
};
