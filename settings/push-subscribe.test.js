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
