import { getClient, cloudEnabled } from '../db.js';

const LOCAL_KEY = 'life-os:finance:pay-settings:v1';
const DEFAULT_SETTINGS = {
  baseHourlyRate: 0,
  weekendMultiplier: 1.5,
  holidayMultiplier: 2.0,
  currency: 'MYR',
};

function toRow(s) {
  return {
    base_hourly_rate: s.baseHourlyRate,
    weekend_multiplier: s.weekendMultiplier,
    holiday_multiplier: s.holidayMultiplier,
    currency: s.currency,
  };
}
function fromRow(r) {
  return {
    baseHourlyRate: r.base_hourly_rate,
    weekendMultiplier: r.weekend_multiplier,
    holidayMultiplier: r.holiday_multiplier,
    currency: r.currency,
  };
}

const LocalRepo = {
  async get() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LOCAL_KEY)) }; }
    catch { return DEFAULT_SETTINGS; }
  },
  async upsert(settings) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
    return settings;
  },
};

const CloudRepo = {
  async get() {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c.from('pay_settings').select('*').maybeSingle();
    if (error) throw error;
    return data ? fromRow(data) : DEFAULT_SETTINGS;
  },
  async upsert(settings) {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { error } = await c.from('pay_settings').upsert({ user_id: user.id, ...toRow(settings) });
    if (error) throw error;
    return settings;
  },
};

export const PaySettingsRepo = cloudEnabled ? CloudRepo : LocalRepo;
