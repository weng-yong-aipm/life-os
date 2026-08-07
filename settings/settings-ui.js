import { SettingsRepo } from './settings-repo.js';
import { HIDEABLE_MODULES } from './settings.js';

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
