import { getClient, cloudEnabled } from '../db.js';
import { demoMode, fixtures } from '../demo.js';

function toRow(e) {
  return {
    id: e.id,
    spentAt: e.spent_at,
    amount: Number(e.amount),
    category: e.category,
    note: e.note,
  };
}

export const ExpensesRepo = {
  async create({ spentAt, amount, category, note }) {
    const c = await getClient();
    if (!c) throw new Error('Expenses need cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c
      .from('expenses')
      .insert({ user_id: user.id, spent_at: spentAt, amount, category: category || 'other', note: note || null })
      .select()
      .single();
    if (error) throw error;
    return toRow(data);
  },

  async list() {
    if (demoMode) return fixtures.expenses;
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c.from('expenses').select('*').order('spent_at', { ascending: false });
    if (error) throw error;
    return data.map(toRow);
  },

  async monthlySummary(yyyymm) {
    if (!cloudEnabled) return null;
    const rows = await this.list();
    const inMonth = rows.filter((r) => (r.spentAt || '').slice(0, 7) === yyyymm);
    const byCategory = {};
    let total = 0;
    for (const r of inMonth) {
      byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
      total += r.amount;
    }
    return { total, byCategory };
  },
};
