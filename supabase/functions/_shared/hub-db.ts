// Data access for the check-in loop. Service-role client, scoped to the single owner.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { PushSubscriptionRow } from './push.ts';

export interface Milestone { id: string; title: string; due: string; status: string; next_step: string }
export interface HubDb {
  listMilestones(): Promise<Milestone[]>;
  listCheckins(fromDay: string): Promise<{ day: string; done: boolean }[]>;
  listSubscriptions(): Promise<PushSubscriptionRow[]>;
  deleteSubscription(id: number): Promise<void>;
  getSyncStatus(): Promise<{ synced_at: string | null; ok: boolean; error: string | null } | null>;
  upsertCheckin(row: { day: string; milestone_id: string; done: boolean }): Promise<void>;
}

function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function makeDb(sb: SupabaseClient, userId: string): HubDb {
  return {
    async listMilestones() {
      return must(await sb.from('milestones').select('id,title,due,status,next_step').eq('user_id', userId)) ?? [];
    },
    async listCheckins(fromDay) {
      return must(await sb.from('checkins').select('day,done').eq('user_id', userId).gte('day', fromDay)) ?? [];
    },
    async listSubscriptions() {
      return must(await sb.from('push_subscriptions').select('id,endpoint,p256dh,auth,created_at').eq('user_id', userId)) ?? [];
    },
    async deleteSubscription(id) {
      must(await sb.from('push_subscriptions').delete().eq('id', id));
    },
    async getSyncStatus() {
      return must(await sb.from('goal_sync_status').select('synced_at,ok,error').eq('user_id', userId).maybeSingle());
    },
    async upsertCheckin(row) {
      must(await sb.from('checkins').upsert({ ...row, user_id: userId, answered_at: new Date().toISOString() }, { onConflict: 'user_id,day' }));
    },
  };
}
