/* Pure loop-guard for the Obsidian bridge daemon.
 *
 * The daemon both writes vault notes (DB->vault export) and watches the vault
 * to reverse-sync user edits (vault->DB). Its own writes trigger fs.watch
 * events; without a guard those get pushed back to the DB, re-exported, and the
 * daemon ping-pongs forever. This module answers ONE question, purely:
 *
 *   "This fs event fired for a file whose content is now X. Did *I* just write
 *    exactly X (recently)? If so, ignore it."
 *
 * A user edit changes the content, so its hash won't match what the daemon
 * recorded -> not ignored. A record older than the TTL -> not ignored (stale).
 * No I/O, no clock, no shared mutable state: the caller passes the record, the
 * content, and the current time. Trivially unit-testable. */

import { createHash } from 'node:crypto';

/* Content fingerprint. Deterministic — same content, same hash. */
export function hashContent(content) {
  return createHash('sha1').update(String(content)).digest('hex');
}

/* Build the record to stash when the daemon writes a note. Pure. */
export function writeRecord(content, now) {
  return { hash: hashContent(content), at: now };
}

/* Should this fs event be ignored (i.e. was it the daemon's own recent write)?
 *
 *   record  - the last write the daemon recorded for this path ({hash, at}) or
 *             null/undefined if it never wrote it.
 *   content - the file's current content as read after the event.
 *   now     - current time (ms).
 *   ttlMs   - how long a recorded write stays authoritative.
 *
 * Ignore only when a record exists, is still within TTL, AND the on-disk
 * content still matches what the daemon wrote. Any user edit breaks the hash
 * match; an expired record breaks the time check. Both cases -> not ignored. */
export function shouldIgnore(record, content, now, ttlMs) {
  if (!record) return false;
  if (now - record.at > ttlMs) return false; // stale — treat as a real edit
  return record.hash === hashContent(content);
}
