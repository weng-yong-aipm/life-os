import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSource, SOURCES } from './source.js';

test('withSource defaults to manual + null key', () => {
  assert.deepEqual(withSource({ a: 1 }), { a: 1, source: 'manual', source_key: null });
});

test('withSource stamps an explicit source and key', () => {
  assert.deepEqual(
    withSource({ a: 1 }, 'douyin', '7663324074667494656'),
    { a: 1, source: 'douyin', source_key: '7663324074667494656' },
  );
});

test('withSource rejects an unknown source', () => {
  assert.throws(() => withSource({ a: 1 }, 'bogus'), /unknown source/);
});

test('withSource does not mutate its input', () => {
  const input = { a: 1 };
  withSource(input, 'obsidian', 'x');
  assert.deepEqual(input, { a: 1 });
});

test('SOURCES contains the connectors the blueprint names', () => {
  for (const s of ['manual', 'obsidian', 'douyin', 'notebooklm', 'lark', 'gdrive']) {
    assert.ok(SOURCES.includes(s), `missing ${s}`);
  }
});
