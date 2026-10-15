import {
  addDays, driftMessage, evaluateDrift, eveningMessage, localDay, mintToken, pickFocus, syncNotice,
} from '../_shared/hub-core.js';
import type { HubDb } from '../_shared/hub-db.ts';
import type { PushSender } from '../_shared/push.ts';

export interface NudgeDeps {
  env: { JOB_SECRET: string; CHECKIN_SECRET: string; OWNER_USER_ID: string; CHECKIN_URL: string };
  db: HubDb;
  sender: PushSender;
  now: () => Date;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handleNudge(req: Request, deps: NudgeDeps): Promise<Response> {
  if (!deps.env.JOB_SECRET || req.headers.get('x-job-secret') !== deps.env.JOB_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  const mode = new URL(req.url).searchParams.get('mode');
  if (mode !== 'evening' && mode !== 'drift') return new Response('mode must be evening|drift', { status: 400 });

  const now = deps.now();
  const today = localDay(now);
  const [milestones, status, subs] = await Promise.all([
    deps.db.listMilestones(), deps.db.getSyncStatus(), deps.db.listSubscriptions(),
  ]);
  if (!subs.length) return json({ sent: 0, reason: 'no subscriptions' });
  const notice = syncNotice({ status, now });
  const focus = pickFocus(milestones);

  let payload;
  if (mode === 'evening') {
    const token = focus
      ? await mintToken(deps.env.CHECKIN_SECRET, { userId: deps.env.OWNER_USER_ID, day: today, milestoneId: focus.id })
      : null;
    payload = eveningMessage({ focus, day: today, token, checkinUrl: deps.env.CHECKIN_URL, notice });
  } else {
    const since = localDay(new Date(Math.min(...subs.map((s) => Date.parse(s.created_at)))));
    const checkins = await deps.db.listCheckins(addDays(today, -60));
    payload = driftMessage({ drift: evaluateDrift({ today, checkins, since }), focus, notice });
    if (!payload) return json({ sent: 0 });
  }

  let sent = 0;
  for (const s of subs) {
    const { status: code } = await deps.sender.send(s, JSON.stringify(payload));
    if (code === 404 || code === 410) await deps.db.deleteSubscription(s.id);
    else if (code >= 200 && code < 300) sent++;
    else console.error('push status', code);
  }
  return json({ sent });
}
