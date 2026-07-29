import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldIgnore, writeRecord, hashContent } from './loop-guard.js';

const TTL = 5000;
const NOTE = '---\nlifeos_id: 42\n---\n\n# Title\n\nBody prose.\n';

test('a file the daemon just wrote is ignored (own-write echo)', () => {
  const record = writeRecord(NOTE, 1000);
  // fs.watch fires a moment later; on-disk content is exactly what we wrote.
  assert.equal(shouldIgnore(record, NOTE, 1200, TTL), true);
});

test('a file the USER edited is NOT ignored (content diverged)', () => {
  const record = writeRecord(NOTE, 1000);
  const edited = NOTE.replace('Body prose.', 'Body prose, now with the user’s edit.');
  // Same path, still within TTL, but the content hash no longer matches.
  assert.equal(shouldIgnore(record, edited, 1200, TTL), false);
});

test('the guard expires: an old own-write record is no longer honored', () => {
  const record = writeRecord(NOTE, 1000);
  // Same identical content, but the record is older than the TTL window.
  assert.equal(shouldIgnore(record, NOTE, 1000 + TTL + 1, TTL), false);
});

test('no record at all -> never ignored (first time we see this path)', () => {
  assert.equal(shouldIgnore(undefined, NOTE, 1200, TTL), false);
  assert.equal(shouldIgnore(null, NOTE, 1200, TTL), false);
});

test('hashContent is deterministic and content-sensitive', () => {
  assert.equal(hashContent(NOTE), hashContent(NOTE));
  assert.notEqual(hashContent(NOTE), hashContent(NOTE + ' '));
});

test('boundary: exactly at TTL is still honored, one ms past is not', () => {
  const record = writeRecord(NOTE, 1000);
  assert.equal(shouldIgnore(record, NOTE, 1000 + TTL, TTL), true);
  assert.equal(shouldIgnore(record, NOTE, 1000 + TTL + 1, TTL), false);
});
