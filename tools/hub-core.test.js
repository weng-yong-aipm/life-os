import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDay, addDays, daysBetween, pickFocus, evaluateDrift, syncNotice,
  eveningMessage, driftMessage, mintToken, verifyToken, parseCheckinBody,
} from '../supabase/functions/_shared/hub-core.js';

test('localDay is the Kuala Lumpur day, not the UTC day', () => {
  // 2026-10-15 23:30 UTC is already 07:30 on the 16th in MYT.
  assert.equal(localDay(new Date('2026-10-15T23:30:00Z')), '2026-10-16');
  // 13:00 UTC is the 21:00 MYT push — same calendar day.
  assert.equal(localDay(new Date('2026-10-15T13:00:00Z')), '2026-10-15');
});

test('addDays and daysBetween cross month ends', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 3);
});

const M = (id, due, status, next_step = 'step') => ({ id, title: id, due, status, next_step });

test('pickFocus takes the earliest-due open milestone, ties by id', () => {
  const ms = [M('b', '2026-11-01', 'todo'), M('a', '2026-11-01', 'doing'), M('c', '2026-10-01', 'done')];
  assert.equal(pickFocus(ms).id, 'a');
});

test('pickFocus returns null when nothing is open', () => {
  assert.equal(pickFocus([M('a', '2026-10-01', 'done'), M('b', '2026-10-02', 'dropped')]), null);
  assert.equal(pickFocus([]), null);
});

const TODAY = '2026-10-20';
const C = (n, done) => ({ day: addDays(TODAY, -n), done });

test('no drift before three in-scope days exist', () => {
  // Subscribed two days ago: only 2 of the 3 window days are in scope.
  const r = evaluateDrift({ today: TODAY, checkins: [], since: addDays(TODAY, -2) });
  assert.deepEqual(r, { drifting: false, stalledDays: 0 });
  assert.equal(evaluateDrift({ today: TODAY, checkins: [], since: null }).drifting, false);
});

test('three in-scope days with no done is drift; unanswered counts as not done', () => {
  const r = evaluateDrift({ today: TODAY, checkins: [C(1, false)], since: addDays(TODAY, -5) });
  assert.deepEqual(r, { drifting: true, stalledDays: 5 });
});

test('one done day inside the window means no drift', () => {
  const r = evaluateDrift({ today: TODAY, checkins: [C(3, true)], since: addDays(TODAY, -10) });
  assert.equal(r.drifting, false);
});

test('stalledDays counts back to the last done day', () => {
  const r = evaluateDrift({ today: TODAY, checkins: [C(6, true), C(2, false)], since: addDays(TODAY, -10) });
  assert.deepEqual(r, { drifting: true, stalledDays: 5 });
});

test('a done check-in TODAY does not hide drift in the window (the morning run is before tonight)', () => {
  const r = evaluateDrift({ today: TODAY, checkins: [{ day: TODAY, done: true }], since: addDays(TODAY, -5) });
  assert.equal(r.drifting, true);
});

const NOW = new Date('2026-10-20T00:00:00Z'); // 08:00 MYT on the 20th

test('syncNotice: healthy recent sync says nothing', () => {
  assert.equal(syncNotice({ status: { synced_at: '2026-10-19T00:00:00Z', ok: true, error: null }, now: NOW }), null);
});

test('syncNotice: never synced, failed, or stale all speak up', () => {
  assert.equal(syncNotice({ status: null, now: NOW }), '目标数据从未同步');
  assert.match(syncNotice({ status: { synced_at: '2026-10-19T00:00:00Z', ok: false, error: 'line 7: bad due' }, now: NOW }), /^目标数据同步失败：line 7: bad due/);
  assert.equal(syncNotice({ status: { synced_at: '2026-10-15T23:00:00Z', ok: true, error: null }, now: NOW }), '目标数据 4 天未同步');
});

test('syncNotice: exactly 3 days old is still fine', () => {
  assert.equal(syncNotice({ status: { synced_at: '2026-10-17T00:00:00Z', ok: true, error: null }, now: NOW }), null);
});

test('eveningMessage carries the buttons and the check-in data', () => {
  const focus = M('m1', '2026-11-01', 'doing', '写资料页');
  const p = eveningMessage({ focus: { ...focus, title: '副业上架' }, day: '2026-10-20', token: 'T', checkinUrl: 'https://x/functions/v1/checkin', notice: null });
  assert.equal(p.title, '今天主线');
  assert.equal(p.body, '副业上架：写资料页。做了吗？');
  assert.deepEqual(p.actions, [{ action: 'done', title: '做了' }, { action: 'not_done', title: '没做' }]);
  assert.deepEqual(p.data, { day: '2026-10-20', milestone_id: 'm1', token: 'T', checkinUrl: 'https://x/functions/v1/checkin' });
  assert.equal(p.tag, 'checkin-2026-10-20');
});

test('eveningMessage with no focus has no actions', () => {
  const p = eveningMessage({ focus: null, day: '2026-10-20', token: null, checkinUrl: 'u', notice: '目标数据 4 天未同步' });
  assert.equal(p.actions, undefined);
  assert.equal(p.body, '目标数据 4 天未同步\n没有进行中的里程碑——总计划需要更新');
});

test('driftMessage: nothing to say returns null; notice alone is still sent', () => {
  assert.equal(driftMessage({ drift: { drifting: false, stalledDays: 0 }, focus: null, notice: null }), null);
  const p = driftMessage({ drift: { drifting: false, stalledDays: 0 }, focus: null, notice: '目标数据从未同步' });
  assert.equal(p.title, '目标数据异常');
});

test('driftMessage when drifting names the next step', () => {
  const p = driftMessage({ drift: { drifting: true, stalledDays: 4 }, focus: { ...M('m1', '2026-11-01', 'doing', '写资料页'), title: '副业上架' }, notice: null });
  assert.equal(p.title, '主线已停 4 天');
  assert.equal(p.body, '下一步：副业上架：写资料页');
});

const S = 'test-secret';
const T = { userId: 'u1', day: '2026-10-20', milestoneId: 'm1' };

test('verifyToken accepts the push day on the same and the following day', async () => {
  const token = await mintToken(S, T);
  assert.equal(await verifyToken(S, { ...T, token, today: '2026-10-20' }), true);
  assert.equal(await verifyToken(S, { ...T, token, today: '2026-10-21' }), true);
});

test('verifyToken rejects later days, other days, other milestones, and garbage', async () => {
  const token = await mintToken(S, T);
  assert.equal(await verifyToken(S, { ...T, token, today: '2026-10-22' }), false);
  assert.equal(await verifyToken(S, { ...T, day: '2026-10-21', token, today: '2026-10-21' }), false);
  assert.equal(await verifyToken(S, { ...T, milestoneId: 'm2', token, today: '2026-10-20' }), false);
  assert.equal(await verifyToken(S, { ...T, token: 'x', today: '2026-10-20' }), false);
  assert.equal(await verifyToken('', { ...T, token, today: '2026-10-20' }), false);
});

test('parseCheckinBody accepts only the exact shape', () => {
  const ok = { day: '2026-10-20', milestone_id: 'm1', done: true, token: 'abc' };
  assert.deepEqual(parseCheckinBody(ok), ok);
  assert.equal(parseCheckinBody({ ...ok, done: 'true' }), null);
  assert.equal(parseCheckinBody({ ...ok, day: '2026-10-2' }), null);
  assert.equal(parseCheckinBody({ ...ok, milestone_id: 'x'.repeat(65) }), null);
  assert.equal(parseCheckinBody(null), null);
});
