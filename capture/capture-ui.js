import { validate } from './capture.js';
import { CaptureRepo } from './capture-repo.js';

const $ = (id) => document.getElementById(id);

function say(msg, kind) {
  const el = $('cap-msg');
  el.textContent = msg;
  el.className = kind ? `msg ${kind}` : 'msg';
}

async function submit(ev) {
  ev.preventDefault();
  const btn = $('cap-send');
  const check = validate($('cap-url').value);
  if (!check.ok) return say(check.error, 'err');

  btn.disabled = true;
  say('Sending…');
  try {
    await CaptureRepo.add({ url: check.url, note: $('cap-note').value.trim() });
    $('cap-url').value = '';
    $('cap-note').value = '';
    say(`Queued for the Desk · ${check.lane}`, 'ok');
    $('cap-url').focus();
  } catch (e) {
    say(e.message || 'Could not queue that link.', 'err');
  } finally {
    btn.disabled = false;
  }
}

/* Preview the detected lane as you type, so a mis-pasted link is obvious
 * before you send it rather than after the Desk fails to fetch it. */
function preview() {
  const v = $('cap-url').value.trim();
  if (!v) return say('');
  const check = validate(v);
  say(check.ok ? `Looks like: ${check.lane}` : check.error, check.ok ? '' : 'err');
}

$('cap-form').addEventListener('submit', submit);
$('cap-url').addEventListener('input', preview);

/* Accept ?url= so the iOS/Android share sheet can deep-link straight in. */
const shared = new URLSearchParams(location.search).get('url');
if (shared) {
  $('cap-url').value = shared;
  preview();
}
