/* Pure helpers for the nightly check-in push. No I/O. classifyCheckinResult is
 * duplicated inline in service-worker.js (a classic worker cannot import ES
 * modules); keep the two in step. */

export function urlBase64ToUint8Array(s) {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function pushStateLabel({ supported, permission, subscribed }) {
  if (!supported) return '这个浏览器不支持推送';
  if (permission === 'denied') return '通知被拦截了：请在 Chrome 网站设置里允许通知';
  return subscribed ? '提醒已开启' : '提醒未开启';
}

/* 4xx means the token or body will never be accepted — retrying would loop the
 * notification forever. Only network errors and 5xx are worth a second tap. */
export function classifyCheckinResult(r) {
  if (typeof r !== 'number') return 'retry';
  if (r >= 200 && r < 300) return 'ok';
  if (r >= 400 && r < 500) return 'expired';
  return 'retry';
}
