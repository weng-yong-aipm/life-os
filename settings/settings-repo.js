import { getClient } from '../db.js';
import { DEFAULTS, mergeSettings } from './settings.js';

function toRow(s) {
  return {
    daily_kcal_target: s.dailyKcalTarget,
    daily_protein_target_g: s.dailyProteinTargetG,
    body_weight_kg: s.bodyWeightKg,
    sleep_target_min: s.sleepTargetMin,
    hidden_modules: s.hiddenModules,
  };
}

export const SettingsRepo = {
  async get() {
    const c = await getClient();
    if (!c) return DEFAULTS;
    const { data: { user } } = await c.auth.getUser();
    if (!user) return DEFAULTS;
    const { data, error } = await c.from('user_settings').select('*').maybeSingle();
    if (error) throw error;
    return mergeSettings(data);
  },
  async save(settings) {
    const c = await getClient();
    if (!c) throw new Error('Settings need cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { error } = await c.from('user_settings').upsert({ user_id: user.id, ...toRow(settings) });
    if (error) throw error;
    return settings;
  },
};
