import { LogRepo } from './log-repo.js';
import { summarize } from './parse-log.js';

const $ = (id) => document.getElementById(id);
const text = $('log-text');
const readBtn = $('log-read');
const status = $('log-status');
const preview = $('log-preview');
const result = $('log-result');

let pending = null;

const KIND_ICON = { meal: '🍳', sleep: '😴', expense: '💸', learning: '📚' };

/* One line per row, in the user's own terms rather than the table's. The row
 * has to be checkable at a glance — if reading the preview costs as much as
 * filling the form did, this page has not removed anything. */
function rowLine(r) {
  const bits = [];
  if (r.kind === 'meal') {
    bits.push(r.name);
    if (r.calories != null) bits.push(`${Math.round(r.calories)} kcal`);
    if (r.protein_g != null) bits.push(`${Math.round(r.protein_g)}g protein`);
  } else if (r.kind === 'sleep') {
    if (r.duration_min != null) {
      const h = Math.floor(r.duration_min / 60), m = Math.round(r.duration_min % 60);
      bits.push(m ? `${h}h ${m}m` : `${h}h`);
    } else bits.push('slept');
    if (r.quality != null) bits.push(`quality ${r.quality}/5`);
    if (r.note) bits.push(r.note);
  } else if (r.kind === 'expense') {
    bits.push(`${r.amount} · ${r.category}`);
    if (r.note) bits.push(r.note);
  } else if (r.kind === 'learning') {
    bits.push(r.title);
    bits.push(r.source);
  }
  /* An assumed date is called out. A row filed on the wrong day is worse than
   * one that was refused, because nothing downstream can tell it was a guess. */
  const when = r.assumedDate ? `${r.on} (assumed)` : r.on;
  return `${KIND_ICON[r.kind] || '•'} ${bits.filter(Boolean).join(' · ')} — ${when}`;
}

function showPreview(parsed) {
  pending = parsed;
  $('log-summary').textContent = summarize(parsed);
  $('log-rows').innerHTML = parsed.rows.map((r) => `<li>${escapeHtml(rowLine(r))}</li>`).join('');

  /* Anything the model could not read, and anything the parser refused, is
     shown rather than dropped. "Saved!" over a sentence that produced nothing
     is the exact failure this codebase keeps being audited for. */
  const leftovers = [];
  for (const u of parsed.unparsed) leftovers.push(`didn't understand: “${escapeHtml(u)}”`);
  if (parsed.dropped.length) leftovers.push(`${parsed.dropped.length} incomplete row(s) skipped — say the missing part and read it again`);
  $('log-leftovers').innerHTML = leftovers.length
    ? `<ul class="quick-log-leftovers">${leftovers.map((l) => `<li>${l}</li>`).join('')}</ul>`
    : '';

  $('log-save').disabled = parsed.rows.length === 0;
  preview.hidden = false;
  result.hidden = true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function run(btn, label, fn) {
  btn.disabled = true;
  status.textContent = label;
  try {
    await fn();
    status.textContent = '';
  } catch (err) {
    // The reason, not a shrug. Every failure here has an actionable cause:
    // no session, no key, the model wandered, the table rejected the row.
    status.textContent = String(err.message || err);
  } finally {
    btn.disabled = false;
  }
}

readBtn.addEventListener('click', () => {
  const t = text.value.trim();
  if (!t) { status.textContent = 'Type what happened first.'; return; }
  run(readBtn, 'reading…', async () => showPreview(await LogRepo.interpret(t)));
});

$('log-save').addEventListener('click', () => {
  if (!pending?.rows.length) return;
  run($('log-save'), 'saving…', async () => {
    const { saved, failed } = await LogRepo.save(pending.rows);
    const ok = Object.entries(saved).map(([t, n]) => `${n} → ${t}`).join(', ');
    const bad = failed.map((f) => `${f.table} failed (${f.message})`).join('; ');
    // Partial saves say so. Reporting success when three of four tables took
    // the rows is the same defect as a pipeline that exits 0 over a failed step.
    $('log-result-line').textContent = failed.length
      ? `Partly saved — ${ok || 'nothing saved'}. ${bad}`
      : `Saved ${ok}.`;
    $('log-result-line').className = failed.length ? 'quick-log-partial' : 'quick-log-ok';
    preview.hidden = true;
    result.hidden = false;
    pending = null;
  });
});

$('log-cancel').addEventListener('click', () => { preview.hidden = true; pending = null; });

$('log-again').addEventListener('click', () => {
  text.value = '';
  result.hidden = true;
  text.focus();
});
