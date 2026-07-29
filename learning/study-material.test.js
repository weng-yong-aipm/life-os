import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseMaterial, MATERIAL_SCHEMA, MODEL } from './study-material.js';

const row = { title: '大模型面试:消息队列如何处理 agent 长任务', summary: 'durable queue for agent long tasks' };

test('buildRequest targets the model + embeds the row + structured output', () => {
  const req = buildRequest(row);
  assert.equal(req.model, MODEL);
  assert.equal(req.thinking.type, 'disabled');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.deepEqual(req.output_config.format.schema, MATERIAL_SCHEMA);
  assert.match(req.messages[0].content, /消息队列/);
  assert.match(req.messages[0].content, /durable queue/);
});

test('buildRequest honors a model override', () => {
  assert.equal(buildRequest(row, 'claude-haiku-4-5').model, 'claude-haiku-4-5');
});

test('parseMaterial extracts the JSON from the text block', () => {
  const payload = { guide: 'g', flashcards: [{ front: 'q', back: 'a' }], quiz: [{ question: 'x', choices: ['a', 'b'], answer: 'a' }] };
  const resp = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] };
  assert.deepEqual(parseMaterial(resp), payload);
});

test('parseMaterial throws on a refusal', () => {
  assert.throws(() => parseMaterial({ stop_reason: 'refusal', content: [] }), /refused/);
});

test('parseMaterial throws when no text block is present', () => {
  assert.throws(() => parseMaterial({ stop_reason: 'end_turn', content: [] }), /no text block/);
});

test('schema objects all set additionalProperties:false (structured-outputs rule)', () => {
  assert.equal(MATERIAL_SCHEMA.additionalProperties, false);
  assert.equal(MATERIAL_SCHEMA.properties.flashcards.items.additionalProperties, false);
  assert.equal(MATERIAL_SCHEMA.properties.quiz.items.additionalProperties, false);
});
