import { getClient, cloudEnabled } from '../db.js';

const LOCAL_KEY = 'life-os:finance:pay-settings:v1';
const DEFAULT_SETTINGS = {
  baseHourlyRate: 0,
  weekendMultiplier: 1.5,
  holidayMultiplier: 2.0,
  currency: 'MYR',
};

export const LocalRepo = {
  async get() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LOCAL_KEY)) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  async upsert(settings) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
    return settings;
  },
};

export const CloudRepo = {
  async get() {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    const { data, error } = await c
      .from('pay_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return DEFAULT_SETTINGS;
    return {
      baseHourlyRate: data.base_hourly_rate,
      weekendMultiplier: data.weekend_multiplier,
      holidayMultiplier: data.holiday_multiplier,
      currency: data.currency,
    };
  },
  async upsert(settings) {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    const { error } = await c.from('pay_settings').upsert({
      user_id: user.id,
      base_hourly_rate: settings.baseHourlyRate,
      weekend_multiplier: settings.weekendMultiplier,
      holiday_multiplier: settings.holidayMultiplier,
      currency: settings.currency,
    });
    if (error) throw error;
    return settings;
  },
};

export const PaySettingsRepo = cloudEnabled ? CloudRepo : LocalRepo;
