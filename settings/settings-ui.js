import { SettingsRepo } from './settings-repo.js';
import { HIDEABLE_MODULES } from './settings.js';
import { getClient } from '../db.js';
import { VAPID_PUBLIC_KEY } from '../config.js';
import { urlBase64ToUint8Array, pushStateLabel } from './push-subscribe.js';

let current = null;

init();

async function init() {
  current = await SettingsRepo.get();
  document.getElementById('settings-kcal-target').value = current.dailyKcalTarget;
  document.getElementById('settings-protein-target').value = current.dailyProteinTargetG;
  document.getElementById('settings-body-weight').value = current.bodyWeightKg;
  document.getElementById('settings-sleep-target').value = current.sleepTargetMin;
  for (const m of HIDEABLE_MODULES) {
    const el = document.getElementById(`hide-${m}`);
    if (el) el.checked = current.hiddenModules.includes(m);
  }

  document.getElementById('settings-form').addEventListener('submit', onSaveTargets);
  document.getElementById('hidden-modules-form').addEventListener('submit', onSaveHidden);
  await initPush();
}

async function onSaveTargets(e) {
  e.preventDefault();
  const status = document.getElementById('settings-status');
  try {
    current = await SettingsRepo.save({
      ...current,
      dailyKcalTarget: parseFloat(document.getElementById('settings-kcal-target').value) || 0,
      dailyProteinTargetG: parseFloat(document.getElementById('settings-protein-target').value) || 0,
      bodyWeightKg: parseFloat(document.getElementById('settings-body-weight').value) || 0,
      sleepTargetMin: parseFloat(document.getElementById('settings-sleep-target').value) || 0,
    });
    status.textContent = 'Saved.';
  } catch (err) {
    status.textContent = `Could not save (${err.message}).`;
  }
}

async function onSaveHidden(e) {
  e.preventDefault();
  const status = document.getElementById('settings-status');
  const hiddenModules = HIDEABLE_MODULES.filter((m) => document.getElementById(`hide-${m}`)?.checked);
  try {
    current = await SettingsRepo.save({ ...current, hiddenModules });
    status.textContent = 'Saved.';
  } catch (err) {
    status.textContent = `Could not save (${err.message}).`;
  }
}

async function initPush() {
  const btn = document.getElementById('push-enable');
  const status = document.getElementById('push-status');
  const configured = Boolean(VAPID_PUBLIC_KEY);
  const supported = 'serviceWorker' in navigator && 'PushManager' in window;
  // Register here too: only app.js registers the worker, and `ready` never
  // resolves on a fresh browser that opened this page first. Same URL and
  // scope as app.js, so this is a no-op once the worker exists.
  const reg = supported && configured
    ? await navigator.serviceWorker.register('../service-worker.js').then(() => navigator.serviceWorker.ready)
    : null;
  /* "On" means the browser holds a subscription AND its row is in the
   * database. The browser alone said 已开启 forever after a failed insert or a
   * 410 cleanup, while nudge found no subscription and sent nothing. */
  const savedRow = async (sub) => {
    const c = await getClient();
    if (!c || !sub) return false;
    const { data, error } = await c.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
    return !error && Boolean(data);
  };
  const show = async () => {
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const saved = await savedRow(sub);
    status.textContent = pushStateLabel({
      supported, configured, permission: supported ? Notification.permission : 'default', subscribed: Boolean(sub), saved,
    });
    btn.disabled = !reg || (Boolean(sub) && saved);
  };
  await show();
  btn.addEventListener('click', async () => {
    try {
      const c = await getClient();
      const user = c ? (await c.auth.getUser()).data.user : null;
      if (!user) throw new Error('请先登录');
      if ((await Notification.requestPermission()) !== 'granted') return show();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error } = await c.from('push_subscriptions').insert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
      if (error && error.code !== '23505') throw error; // 23505: this endpoint is already saved
      await show();
    } catch (err) {
      status.textContent = `开启失败（${err.message}）`;
    }
  });
}
