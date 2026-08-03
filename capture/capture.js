/* Pure capture logic — no I/O. Normalising and validating a pasted URL. */

/* Share sheets and chat apps hand you a URL wrapped in text, tracking params,
 * or a trailing paste artefact. Pull the first http(s) URL out and strip the
 * noise so the Desk gets something it can fetch. */
export function extractUrl(raw) {
  const m = String(raw || '').match(/https?:\/\/[^\s<>"']+/);
  if (!m) return null;
  let url = m[0].replace(/[.,;:!?)\]]+$/, '');
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|share_|from_|spm)/i.test(p)) u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/* Suffix-matching a hostname is a trap: `notdouyin.com` ends with `douyin.com`.
 * Match the registrable domain itself, or a dot-delimited subdomain of it. */
function isHost(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

const LANES = [
  ['douyin', ['douyin.com', 'iesdouyin.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['bilibili', ['bilibili.com', 'b23.tv']],
  ['x', ['twitter.com', 'x.com']],
  ['threads', ['threads.net', 'threads.com']],
  ['instagram', ['instagram.com']],
  ['reddit', ['reddit.com']],
];

/* 抖音 share links arrive as v.douyin.com shortlinks; label them so the Desk
 * can pick the right ingest lane without re-fetching to find out. */
export function laneFor(url) {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase(); } catch { return 'article'; }
  for (const [lane, domains] of LANES) {
    if (domains.some((d) => isHost(h, d))) return lane;
  }
  return 'article';
}

export function validate(raw) {
  const url = extractUrl(raw);
  if (!url) return { ok: false, error: 'No http(s) link found in that text.' };
  return { ok: true, url, lane: laneFor(url) };
}
