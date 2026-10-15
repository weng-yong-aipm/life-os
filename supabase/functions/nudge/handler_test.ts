import { assertEquals } from 'jsr:@std/assert@1';
import { handleNudge } from './handler.ts';

const MS = [{ id: 'm1', title: '副业上架', due: '2026-11-01', status: 'doing', next_step: '写资料页' }];
const SUB = { id: 1, user_id: 'u1', endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a', created_at: '2026-10-01T00:00:00Z' };

function deps(over: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const deleted: number[] = [];
  const d = {
    env: { JOB_SECRET: 'js', CHECKIN_SECRET: 'cs', OWNER_USER_ID: 'u1', CHECKIN_URL: 'https://x/functions/v1/checkin' },
    db: {
      listMilestones: () => Promise.resolve(MS),
      listCheckins: () => Promise.resolve([] as { day: string; done: boolean }[]),
      listSubscriptions: () => Promise.resolve([SUB]),
      deleteSubscription: (id: number) => { deleted.push(id); return Promise.resolve(); },
      getSyncStatus: () => Promise.resolve({ synced_at: '2026-10-19T23:00:00Z', ok: true, error: null }),
      upsertCheckin: () => Promise.resolve(),
    },
    sender: { send: (_s: unknown, p: string) => { sent.push(p); return Promise.resolve({ status: 201 }); } },
    now: () => new Date('2026-10-20T13:00:00Z'),
    ...over,
  };
  return { d, sent, deleted };
}
const req = (mode: string, secret = 'js') =>
  new Request(`https://x/functions/v1/nudge?mode=${mode}`, { method: 'POST', headers: { 'x-job-secret': secret } });

Deno.test('wrong job secret is 401 and sends nothing', async () => {
  const { d, sent } = deps();
  assertEquals((await handleNudge(req('evening', 'nope'), d)).status, 401);
  assertEquals(sent.length, 0);
});

Deno.test('evening sends the focus with a token for today', async () => {
  const { d, sent } = deps();
  assertEquals((await handleNudge(req('evening'), d)).status, 200);
  const p = JSON.parse(sent[0]);
  assertEquals(p.body, '副业上架：写资料页。做了吗？');
  assertEquals(p.data.day, '2026-10-20');
  assertEquals(typeof p.data.token, 'string');
});

Deno.test('a 410 subscription is deleted', async () => {
  const { d, deleted } = deps({ sender: { send: () => Promise.resolve({ status: 410 }) } });
  await handleNudge(req('evening'), d);
  assertEquals(deleted, [1]);
});

Deno.test('drift mode with healthy checkins and fresh sync sends nothing', async () => {
  const { d, sent } = deps({
    now: () => new Date('2026-10-20T00:00:00Z'),
    db: { ...deps().d.db, listCheckins: () => Promise.resolve([{ day: '2026-10-19', done: true }]) },
  });
  await handleNudge(req('drift'), d);
  assertEquals(sent.length, 0);
});

Deno.test('drift mode with healthy checkins still sends a stale-sync notice', async () => {
  const { d, sent } = deps({
    now: () => new Date('2026-10-20T00:00:00Z'),
    db: {
      ...deps().d.db,
      listCheckins: () => Promise.resolve([{ day: '2026-10-19', done: true }]),
      getSyncStatus: () => Promise.resolve({ synced_at: '2026-10-10T00:00:00Z', ok: true, error: null }),
    },
  });
  await handleNudge(req('drift'), d);
  assertEquals(JSON.parse(sent[0]).title, '目标数据异常');
});

Deno.test('drift mode with three silent days alerts', async () => {
  const { d, sent } = deps({ now: () => new Date('2026-10-20T00:00:00Z') });
  await handleNudge(req('drift'), d);
  assertEquals(JSON.parse(sent[0]).title.startsWith('主线已停'), true);
});

Deno.test('unknown mode is 400', async () => {
  const { d } = deps();
  assertEquals((await handleNudge(req('noon'), d)).status, 400);
});
