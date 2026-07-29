import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNote, noteFilename } from './obsidian-export.js';

const row = {
  id: 'aaaa-bbbb',
  source: 'douyin',
  external_id: '7654046883526069556',
  learned_on: '2026-07-27',
  title: '大模型面试:消息队列如何处理 agent 长任务',
  summary: '[@krisswen · ledger:GAP] durable queue for agent long tasks',
  link: 'https://www.douyin.com/video/7654046883526069556',
  tags: ['大模型', 'agent'],
  synced_at: '2026-07-29T07:00:00.000Z',
};

test('filename is stable from source + external_id', () => {
  assert.equal(noteFilename(row), 'douyin-7654046883526069556.md');
});

test('filename falls back to id when no external_id', () => {
  assert.equal(noteFilename({ id: 'xyz', source: 'manual' }), 'xyz.md');
});

test('note carries frontmatter join keys + title/link body', () => {
  const { content } = toNote(row);
  assert.match(content, /^---\n/);
  assert.match(content, /lifeos_id: aaaa-bbbb/);
  assert.match(content, /source: douyin/);
  assert.match(content, /external_id: "7654046883526069556"/);
  assert.match(content, /tags: \[大模型, agent\]/);
  assert.match(content, /# 大模型面试/);
  assert.match(content, /🔗 https:\/\/www\.douyin\.com\/video\/7654046883526069556/);
});

test('omits optional frontmatter lines when absent', () => {
  const { content } = toNote({ id: 'x', source: 'manual', title: 'T' });
  assert.doesNotMatch(content, /external_id:/);
  assert.doesNotMatch(content, /tags:/);
  assert.match(content, /# T/);
});

test('export is deterministic', () => {
  assert.deepEqual(toNote(row), toNote(row));
});
