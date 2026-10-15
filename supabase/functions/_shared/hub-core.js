/* Pure logic for the nightly check-in loop. No I/O, no Node or Deno APIs —
 * only Web-standard globals (Intl, crypto.subtle, btoa), so the same file is
 * unit-tested by `node --test` and imported by the edge functions.
 * docs/superpowers/specs/2026-10-15-unified-hub-design.md */

export const TZ = 'Asia/Kuala_Lumpur';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MILESTONE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/* en-CA formats as YYYY-MM-DD. The UTC slice this replaces files anything
 * before 08:00 MYT under yesterday. */
export function localDay(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10); // pure calendar arithmetic at UTC midnight: safe
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function pickFocus(milestones) {
  const open = milestones.filter((m) => m.status === 'todo' || m.status === 'doing');
  open.sort((a, b) => (a.due === b.due ? (a.id < b.id ? -1 : 1) : (a.due < b.due ? -1 : 1)));
  return open[0] ?? null;
}

/* The window is the 3 days BEFORE today: the drift run is at 08:00, before
 * tonight's push could have been answered. Days before `since` (the first
 * subscription) did not have a loop to answer, so drift needs all 3 in scope. */
export function evaluateDrift({ today, checkins, since }) {
  const window = [1, 2, 3].map((n) => addDays(today, -n));
  if (!since || window.some((d) => d < since)) return { drifting: false, stalledDays: 0 };
  const done = new Set(checkins.filter((c) => c.done).map((c) => c.day));
  if (window.some((d) => done.has(d))) return { drifting: false, stalledDays: 0 };
  let n = 1;
  while (addDays(today, -n) >= since && !done.has(addDays(today, -n))) n++;
  return { drifting: true, stalledDays: n - 1 };
}

export function syncNotice({ status, now }) {
  if (!status || !status.synced_at) return '目标数据从未同步';
  if (!status.ok) return `目标数据同步失败：${String(status.error ?? '').slice(0, 80)}`;
  const age = daysBetween(localDay(new Date(status.synced_at)), localDay(now));
  return age > 3 ? `目标数据 ${age} 天未同步` : null;
}

const NO_FOCUS = '没有进行中的里程碑——总计划需要更新';
const withNotice = (notice, text) => (notice ? `${notice}\n${text}` : text);

export function eveningMessage({ focus, day, token, checkinUrl, notice }) {
  if (!focus) return { title: '今天主线', body: withNotice(notice, NO_FOCUS), data: { open: './plan/' } };
  return {
    title: '今天主线',
    body: withNotice(notice, `${focus.title}：${focus.next_step}。做了吗？`),
    tag: `checkin-${day}`,
    actions: [{ action: 'done', title: '做了' }, { action: 'not_done', title: '没做' }],
    data: { day, milestone_id: focus.id, token, checkinUrl },
  };
}

export function driftMessage({ drift, focus, notice }) {
  if (drift.drifting) {
    const next = focus ? `下一步：${focus.title}：${focus.next_step}` : NO_FOCUS;
    return { title: `主线已停 ${drift.stalledDays} 天`, body: withNotice(notice, next), data: { open: './plan/' } };
  }
  if (notice) return { title: '目标数据异常', body: notice, data: { open: './plan/' } };
  return null;
}

const enc = new TextEncoder();
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function mintToken(secret, { userId, day, milestoneId }) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${userId}|${day}|${milestoneId}`));
  return b64url(new Uint8Array(sig));
}

/* Valid on the push's day and the next one, so a 21:00 push answered at
 * 00:30 still lands on the day it asked about. */
export async function verifyToken(secret, { userId, day, milestoneId, token, today }) {
  if (!secret || typeof token !== 'string') return false;
  if (day !== today && addDays(day, 1) !== today) return false;
  const expected = await mintToken(secret, { userId, day, milestoneId });
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export function parseCheckinBody(body) {
  if (!body || typeof body !== 'object') return null;
  const { day, milestone_id, done, token } = body;
  if (typeof day !== 'string' || !ISO_DAY.test(day)) return null;
  if (typeof milestone_id !== 'string' || !MILESTONE_ID.test(milestone_id)) return null;
  if (typeof done !== 'boolean') return null;
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) return null;
  return { day, milestone_id, done, token };
}
