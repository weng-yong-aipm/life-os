import { getClient } from '../db.js';

function localId() {
  return globalThis.crypto?.randomUUID?.() || 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function parseReceiptPhoto(file) {
  const c = await getClient();
  if (!c) throw new Error('Not signed in — cannot scan receipts without a Supabase connection.');

  const { data: { user } } = await c.auth.getUser();
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
  const storagePath = `${user.id}/${localId()}.${ext}`;

  const { error: uploadErr } = await c.storage.from('receipts').upload(storagePath, file, { contentType: file.type });
  if (uploadErr) throw uploadErr;

  const { data: { session } } = await c.auth.getSession();
  const { data, error } = await c.functions.invoke('parse-receipt', {
    body: { storagePath, mediaType: file.type },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return { storagePath, extracted: data };
}

export async function saveReceipt({ storagePath, merchant, purchasedAt, items }) {
  const c = await getClient();
  if (!c) throw new Error('Not signed in — cannot save receipts without a Supabase connection.');

  const { data: { user } } = await c.auth.getUser();
  const { data: receipt, error: receiptErr } = await c
    .from('receipts')
    .insert({ user_id: user.id, image_path: storagePath, merchant, purchased_at: purchasedAt })
    .select()
    .single();
  if (receiptErr) throw receiptErr;

  const rows = items.map((i) => ({
    receipt_id: receipt.id,
    user_id: user.id,
    name: i.name,
    price: i.price,
    category: i.category,
    calories: i.calories,
    protein_g: i.proteinG,
    carbs_g: i.carbsG,
    fat_g: i.fatG,
    edited_by_user: !!i.editedByUser,
  }));
  const { error: itemsErr } = await c.from('receipt_items').insert(rows);
  if (itemsErr) throw itemsErr;

  return { receipt };
}

async function listReceiptsWithItems() {
  const c = await getClient();
  if (!c) return [];
  const { data, error } = await c.from('receipts').select('*, receipt_items(*)').order('purchased_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function spendByCategory() {
  const receipts = await listReceiptsWithItems();
  const totals = {};
  for (const r of receipts) {
    for (const item of r.receipt_items) {
      const cat = item.category || 'other';
      totals[cat] = (totals[cat] || 0) + (Number(item.price) || 0);
    }
  }
  return totals;
}

export async function caloriesByDay() {
  const receipts = await listReceiptsWithItems();
  const totals = {};
  for (const r of receipts) {
    if (!r.purchased_at) continue;
    const dayTotal = r.receipt_items.reduce((sum, i) => sum + (Number(i.calories) || 0), 0);
    totals[r.purchased_at] = (totals[r.purchased_at] || 0) + dayTotal;
  }
  return totals;
}
