import { localDay, parseCheckinBody, verifyToken } from '../_shared/hub-core.js';
import type { HubDb } from '../_shared/hub-db.ts';

export interface CheckinDeps {
  env: { CHECKIN_SECRET: string; OWNER_USER_ID: string; APP_ORIGIN: string };
  db: Pick<HubDb, 'upsertCheckin'>;
  now: () => Date;
}

export async function handleCheckin(req: Request, deps: CheckinDeps): Promise<Response> {
  const cors = {
    'access-control-allow-origin': deps.env.APP_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  const reply = (status: number) => new Response(null, { status, headers: cors });
  if (req.method === 'OPTIONS') return reply(204);
  if (req.method !== 'POST') return reply(405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400);
  }
  const c = parseCheckinBody(body);
  if (!c) return reply(400);
  const valid = await verifyToken(deps.env.CHECKIN_SECRET, {
    userId: deps.env.OWNER_USER_ID, day: c.day, milestoneId: c.milestone_id, token: c.token, today: localDay(deps.now()),
  });
  if (!valid) return reply(403);
  // Last answer of the day wins: the upsert is on (user_id, day).
  await deps.db.upsertCheckin({ day: c.day, milestone_id: c.milestone_id, done: c.done });
  return reply(204);
}
