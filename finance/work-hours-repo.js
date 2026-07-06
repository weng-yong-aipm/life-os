import { getClient, cloudEnabled } from '../db.js';

const LOCAL_KEY = 'life-os:finance:work-hours:v1';

function localId() {
  return globalThis.crypto?.randomUUID?.() || 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toRow(d) {
  return { work_date: d.workDate, hours: d.hours, day_type: d.dayType, computed_pay: d.computedPay };
}
function fromRow(r) {
  return { id: r.id, workDate: r.work_date, hours: r.hours, dayType: r.day_type, computedPay: r.computed_pay };
}

export const LocalRepo = {
  _read() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; }
    catch { return []; }
  },
  _write(arr) { localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)); },
  async list() { return this._read(); },
  async create(data) {
    const arr = this._read();
    const entry = { ...data, id: localId() };
    arr.push(entry);
    this._write(arr);
    return entry;
  },
  async remove(id) {
    this._write(this._read().filter((e) => e.id !== id));
  },
};

export const CloudRepo = {
  async list() {
    const c = await getClient();
    const { data, error } = await c.from('work_hours').select('*').order('work_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromRow);
  },
  async create(data) {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    const { data: row, error } = await c
      .from('work_hours')
      .insert({ ...toRow(data), user_id: user.id })
      .select()
      .single();
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
