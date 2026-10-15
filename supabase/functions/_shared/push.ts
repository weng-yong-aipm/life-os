// Web Push sender. Same pattern as tanfood's _shared/push.ts: web-push only
// encrypts (RFC 8291) and signs (VAPID, RFC 8292); Deno's fetch sends.
import webpush from 'npm:web-push@3';

export interface PushSubscriptionRow { id: number; endpoint: string; p256dh: string; auth: string; created_at: string }
export interface PushSender { send(sub: PushSubscriptionRow, payload: string): Promise<{ status: number }> }

const TTL_SECONDS = 86_400;
const TIMEOUT_MS = 10_000;

export function createWebPushSender(v: { publicKey: string; privateKey: string; subject: string }): PushSender {
  return {
    async send(sub, payload) {
      if (!sub.endpoint.startsWith('https://') || sub.endpoint.length > 1024) return { status: 0 };
      try {
        const d = webpush.generateRequestDetails(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey }, TTL: TTL_SECONDS },
        );
        const res = await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
        await res.body?.cancel();
        return { status: res.status };
      } catch (e) {
        // The endpoint is a live push capability — never log it.
        console.error('push send_error', e instanceof Error ? e.name : typeof e);
        return { status: 0 };
      }
    },
  };
}
