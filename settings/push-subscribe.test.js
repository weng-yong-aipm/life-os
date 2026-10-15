import test from 'node:test';
import assert from 'node:assert/strict';
import { urlBase64ToUint8Array, pushStateLabel, classifyCheckinResult } from './push-subscribe.js';

test('urlBase64ToUint8Array decodes unpadded base64url', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQID_-8')], [1, 2, 3, 255, 239]);
});

test('pushStateLabel covers every state the button can be in', () => {
  assert.equal(pushStateLabel({ supported: false }), '这个浏览器不支持推送');
  assert.equal(pushStateLabel({ supported: true, permission: 'denied' }), '通知被拦截了：请在 Chrome 网站设置里允许通知');
  assert.equal(pushStateLabel({ supported: true, permission: 'granted', subscribed: true }), '提醒已开启');
  assert.equal(pushStateLabel({ supported: true, permission: 'default', subscribed: false }), '提醒未开启');
});

test('classifyCheckinResult: 403 is expired, not retry', () => {
  assert.equal(classifyCheckinResult(204), 'ok');
  assert.equal(classifyCheckinResult(403), 'expired');
  assert.equal(classifyCheckinResult(400), 'expired');
  assert.equal(classifyCheckinResult(500), 'retry');
  assert.equal(classifyCheckinResult(new TypeError('Failed to fetch')), 'retry');
});

test('pushStateLabel: a browser subscription with no saved row is NOT on', () => {
  // The browser kept its subscription but the insert failed (signed out, aal1)
  // or nudge deleted the row after a 410. Reading only the browser said
  // "已开启" forever while nothing was ever sent.
  assert.equal(
    pushStateLabel({ supported: true, permission: 'granted', subscribed: true, saved: false }),
    '提醒未开启（订阅没存上，再点一次）',
  );
  assert.equal(pushStateLabel({ supported: true, permission: 'granted', subscribed: true, saved: true }), '提醒已开启');
});

test('pushStateLabel: a missing VAPID key is a config problem, not the browser', () => {
  assert.equal(pushStateLabel({ supported: true, configured: false }), '提醒还没配置好（缺 VAPID 公钥）');
});

test('classifyCheckinResult: only 400/403 are expired; other 4xx are retried, never called expired', () => {
  // 401 = deployed without --no-verify-jwt, 404 = not deployed / wrong URL,
  // 429 = gateway throttling. None of those mean the notification is stale.
  for (const code of [401, 404, 429]) assert.equal(classifyCheckinResult(code), 'retry', String(code));
});

test('the service worker inline copy of classifyCheckinResult matches this module', async () => {
  const { readFileSync } = await import('node:fs');
  const grab = (src) => src.slice(src.indexOf('function classifyCheckinResult'), src.indexOf('\n}\n', src.indexOf('function classifyCheckinResult')) + 2);
  const here = grab(readFileSync(new URL('./push-subscribe.js', import.meta.url), 'utf8'));
  const sw = grab(readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8'));
  assert.ok(here.length > 40);
  assert.equal(sw, here);
});
