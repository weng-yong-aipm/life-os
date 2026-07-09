import { getClient, cloudEnabled } from '../db.js';

const LOCAL_KEY = 'life-os:finance:work-hours:v1';

function localId() {
  return globalThis.crypto?.randomUUID?.() || 'x_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toRow(d) {
  return { work_date: d.workDate, hours: d.hours, day_type: d.dayType, computed_pay: d.computedPay };
}
function fromRow(r) {
  return { id: r.id, workDate: r.work_date, hours: r.hours, dayType: r.day_type, computedPay: r.computed_pay };
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; }
  catch { return []; }
}
function writeLocal(arr) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
}

const LocalRepo = {
  async list() { return readLocal(); },
  async create(data) {
    const arr = readLocal();
    const entry = { ...data, id: localId() };
    arr.push(entry);
    writeLocal(arr);
    return entry;
  },
  async remove(id) {
    writeLocal(readLocal().filter((e) => e.id !== id));
  },
};

const CloudRepo = {
  async list() {
    const c = await getClient();
    const { data, error } = await c.from('work_hours').select('*').order('work_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromRow);
  },
  async create(data) {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data: row, error } = await c.from('work_hours').insert({ ...toRow(data), user_id: user.id }).select().single();
    if (error) throw error;
    return fromRow(row);
  },
  async remove(id) {
    const c = await getClient();
    const { error } = await c.from('work_hours').delete().eq('id', id);
    if (error) throw error;
  },
};

export const WorkHoursRepo = cloudEnabled ? CloudRepo : LocalRepo;
