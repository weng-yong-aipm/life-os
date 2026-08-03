import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOKS, bookSlug, toLearningRows } from './books.js';

test('BOOKS is a non-trivial curated library with required fields', () => {
  assert.ok(BOOKS.length >= 30);
  for (const b of BOOKS) {
    assert.ok(b.title && b.author && b.category, `every book has title/author/category: ${JSON.stringify(b)}`);
  }
});

test('bookSlug is stable and url-safe', () => {
  assert.equal(bookSlug('Atomic Habits'), 'atomic-habits');
  assert.equal(bookSlug("Poor Charlie's Almanack"), 'poor-charlie-s-almanack');
});

test('toLearningRows maps to learning_sessions shape with source=book', () => {
  const rows = toLearningRows([{ title: 'Atomic Habits', author: 'James Clear', category: 'habits', why: 'compounding.' }], 'u1');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.source, 'book');
  assert.equal(r.external_id, 'atomic-habits');
  assert.equal(r.user_id, 'u1');
  assert.equal(r.title, 'Atomic Habits — James Clear');
  assert.equal(r.verdict, 'considering');
  assert.deepEqual(r.tags, ['habits']);
  assert.match(r.link, /goodreads\.com\/search/);
});

test('toLearningRows skips titleless entries and is deterministic', () => {
  assert.deepEqual(toLearningRows([{ author: 'x' }], 'u1'), []);
  assert.deepEqual(toLearningRows(BOOKS, 'u1'), toLearningRows(BOOKS, 'u1'));
});
