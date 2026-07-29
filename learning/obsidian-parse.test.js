import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNote } from './obsidian-parse.js';
import { toNote } from './obsidian-export.js';

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

test('round-trips prose + join keys through export→parse', () => {
  const { content } = toNote(row);
  const p = parseNote(content);
  assert.equal(p.lifeos_id, row.id);
  assert.equal(p.source, row.source);
  assert.equal(p.external_id, row.external_id);
  assert.equal(p.title, row.title);
  assert.equal(p.summary, row.summary);
});

test('picks up a user-edited summary (Obsidian is authoritative for prose)', () => {
  const { content } = toNote(row);
  const edited = content.replace(row.summary, 'MY OWN NOTES: build this next sprint');
  const p = parseNote(edited);
  assert.equal(p.summary, 'MY OWN NOTES: build this next sprint');
  assert.equal(p.lifeos_id, row.id); // join key still intact
});

test('handles a note with no external_id + empty summary', () => {
  const { content } = toNote({ id: 'x', source: 'manual', title: 'Just a title' });
  const p = parseNote(content);
  assert.equal(p.lifeos_id, 'x');
  assert.equal(p.external_id, null);
  assert.equal(p.title, 'Just a title');
  assert.equal(p.summary, null);
});

test('multi-line summary is preserved', () => {
  const r2 = { ...row, summary: 'line one\nline two' };
  const p = parseNote(toNote(r2).content);
  assert.equal(p.summary, 'line one\nline two');
});
