import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrl, laneFor, validate } from './capture.js';

test('pulls a URL out of share-sheet text', () => {
  assert.equal(
    extractUrl('看看这个 https://v.douyin.com/abc123/ 复制打开抖音'),
    'https://v.douyin.com/abc123/',
  );
});

test('strips tracking params but keeps real ones', () => {
  assert.equal(
    extractUrl('https://example.com/p?id=7&utm_source=x&fbclid=y'),
    'https://example.com/p?id=7',
  );
});

test('drops trailing punctuation from a pasted sentence', () => {
  assert.equal(extractUrl('read https://example.com/a.'), 'https://example.com/a');
});

test('returns null when there is no link', () => {
  assert.equal(extractUrl('just some text'), null);
  assert.equal(extractUrl(''), null);
  assert.equal(extractUrl(null), null);
});

test('labels the ingest lane by host', () => {
  assert.equal(laneFor('https://v.douyin.com/abc/'), 'douyin');
  assert.equal(laneFor('https://youtu.be/xyz'), 'youtube');
  assert.equal(laneFor('https://b23.tv/xyz'), 'bilibili');
  assert.equal(laneFor('https://x.com/u/status/1'), 'x');
  assert.equal(laneFor('https://example.com/post'), 'article');
});

test('a lookalike host does not win the lane', () => {
  assert.equal(laneFor('https://notdouyin.com/x'), 'article');
  assert.equal(laneFor('https://douyin.com.evil.test/x'), 'article');
});

test('validate reports the error rather than throwing', () => {
  assert.deepEqual(validate('nope').ok, false);
  const ok = validate('https://www.douyin.com/video/123');
  assert.equal(ok.ok, true);
  assert.equal(ok.lane, 'douyin');
});
