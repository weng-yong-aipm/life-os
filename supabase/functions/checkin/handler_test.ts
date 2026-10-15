import { assertEquals } from 'jsr:@std/assert@1';
import { mintToken } from '../_shared/hub-core.js';
import { handleCheckin } from './handler.ts';

const ORIGIN = 'https://weng-yong-aipm.github.io';
function deps(now: string) {
  const writes: unknown[] = [];
  return {
    writes,
    d: {
      env: { CHECKIN_SECRET: 'cs', OWNER_USER_ID: 'u1', APP_ORIGIN: ORIGIN },
      db: { upsertCheckin: (r: unknown) => { writes.push(r); return Promise.resolve(); } },
      now: () => new Date(now),
    },
  };
}
const post = (body: unknown) =>
  new Request('https://x/functions/v1/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

Deno.test('preflight answers with CORS for the app origin', async () => {
  const { d } = deps('2026-10-20T13:05:00Z');
  const r = await handleCheckin(new Request('https://x/functions/v1/checkin', { method: 'OPTIONS' }), d);
  assertEquals(r.status, 204);
  assertEquals(r.headers.get('access-control-allow-origin'), ORIGIN);
});

Deno.test('a valid tap writes and returns 204', async () => {
  const { d, writes } = deps('2026-10-20T13:05:00Z');
  const token = await mintToken('cs', { userId: 'u1', day: '2026-10-20', milestoneId: 'm1' });
  const r = await handleCheckin(post({ day: '2026-10-20', milestone_id: 'm1', done: true, token }), d);
  assertEquals(r.status, 204);
  assertEquals(writes, [{ day: '2026-10-20', milestone_id: 'm1', done: true }]);
});

Deno.test('checkin writes the day from the push, not today (tap after midnight)', async () => {
  const { d, writes } = deps('2026-10-20T16:30:00Z'); // 00:30 MYT on the 21st
  const token = await mintToken('cs', { userId: 'u1', day: '2026-10-20', milestoneId: 'm1' });
  assertEquals((await handleCheckin(post({ day: '2026-10-20', milestone_id: 'm1', done: false, token }), d)).status, 204);
  assertEquals(writes, [{ day: '2026-10-20', milestone_id: 'm1', done: false }]);
});

Deno.test('a forged or expired token is 403 and writes nothing', async () => {
  const { d, writes } = deps('2026-10-22T13:05:00Z');
  const token = await mintToken('cs', { userId: 'u1', day: '2026-10-20', milestoneId: 'm1' });
  assertEquals((await handleCheckin(post({ day: '2026-10-20', milestone_id: 'm1', done: true, token }), d)).status, 403);
  assertEquals((await handleCheckin(post({ day: '2026-10-22', milestone_id: 'm1', done: true, token: 'forged' }), d)).status, 403);
  assertEquals(writes.length, 0);
});

Deno.test('a malformed body is 400', async () => {
  const { d } = deps('2026-10-20T13:05:00Z');
  assertEquals((await handleCheckin(post({ day: 'x' }), d)).status, 400);
  const bad = new Request('https://x/functions/v1/checkin', { method: 'POST', body: '{' });
  assertEquals((await handleCheckin(bad, d)).status, 400);
});
