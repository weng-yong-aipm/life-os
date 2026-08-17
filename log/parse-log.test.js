import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResult, summarize, toInserts } from './parse-log.js';

const TODAY = '2026-08-17';

test('a normal sentence becomes one row per thing', () => {
  const out = parseResult({
    rows: [
      { kind: 'meal', on: TODAY, name: 'chicken rice', calories: 600, protein_g: 35, carbs_g: 70, fat_g: 18 },
      { kind: 'expense', on: TODAY, amount: 12.5, category: 'food', note: 'lunch' },
    ],
    unparsed: [],
  }, TODAY);
  assert.equal(out.rows.length, 2);
  assert.equal(out.error, null);
  assert.equal(summarize(out), '1 meal, 1 expense');
});

test('sleep is kept on the wake date the model gave', () => {
  const out = parseResult({ rows: [{ kind: 'sleep', on: '2026-08-16', duration_min: 430, quality: 3 }] }, TODAY);
  assert.equal(out.rows[0].on, '2026-08-16');
  assert.equal(out.rows[0].duration_min, 430);
});

test('a quality score outside 1-5 becomes null instead of failing the whole insert', () => {
  // The column has a check constraint. One bad score must not take the meal
  // and the expense in the same sentence down with it.
  const out = parseResult({ rows: [{ kind: 'sleep', on: TODAY, quality: 9 }] }, TODAY);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].quality, null);
});

test('rows missing the one field that defines them are dropped, not filed half-empty', () => {
  const out = parseResult({
    rows: [
      { kind: 'meal', on: TODAY },                       // no dish
      { kind: 'expense', on: TODAY, category: 'food' },  // no amount
      { kind: 'expense', on: TODAY, amount: 0 },         // zero is not a spend
      { kind: 'learning', on: TODAY, source: 'douyin' }, // no title
      { kind: 'nonsense', on: TODAY },
    ],
  }, TODAY);
  assert.equal(out.rows.length, 0);
  assert.equal(out.dropped.length, 5);
});

test('what was dropped or not understood is reported, never swallowed', () => {
  // The defect this whole project keeps hitting is a success message over work
  // that did not happen. A sentence that produced no row must say so.
  const out = parseResult({ rows: [{ kind: 'meal', on: TODAY }], unparsed: ['felt off today'] }, TODAY);
  assert.equal(summarize(out), 'nothing — 1 not understood, 1 incomplete');
});

test('an unusable date falls back to today and is flagged as assumed', () => {
  const out = parseResult({ rows: [{ kind: 'meal', on: 'sometime', name: 'nasi lemak' }] }, TODAY);
  assert.equal(out.rows[0].on, TODAY);
  assert.equal(out.rows[0].assumedDate, true);
});

test('a real date is not flagged as assumed', () => {
  const out = parseResult({ rows: [{ kind: 'meal', on: TODAY, name: 'nasi lemak' }] }, TODAY);
  assert.equal(out.rows[0].assumedDate, false);
});

test('a non-JSON reply is an error, not an empty success', () => {
  const out = parseResult('Sure! Here are your rows:', TODAY);
  assert.equal(out.rows.length, 0);
  assert.equal(out.error, 'model did not return JSON');
});

test('unknown category and source fall back rather than writing free text', () => {
  const out = parseResult({
    rows: [
      { kind: 'expense', on: TODAY, amount: 5, category: 'Bubble Tea Money' },
      { kind: 'learning', on: TODAY, title: 'x', source: 'TikTok' },
    ],
  }, TODAY);
  assert.equal(out.rows[0].category, 'other');
  assert.equal(out.rows[1].source, 'other');
});

test('inserts carry the exact column names each table has', () => {
  const { rows } = parseResult({
    rows: [
      { kind: 'meal', on: TODAY, name: 'chicken rice', calories: 600 },
      { kind: 'sleep', on: TODAY, duration_min: 400, quality: 4 },
      { kind: 'expense', on: TODAY, amount: 12.5, category: 'food' },
      { kind: 'learning', on: TODAY, title: 'a video', source: 'douyin' },
    ],
  }, TODAY);
  const ins = toInserts(rows, 'user-1');

  assert.deepEqual(Object.keys(ins.meals[0]).sort(),
    ['calories', 'carbs_g', 'eaten_at', 'fat_g', 'name', 'protein_g', 'source', 'user_id']);
  assert.deepEqual(Object.keys(ins.sleep[0]).sort(),
    ['duration_min', 'note', 'quality', 'slept_on', 'source', 'user_id']);
  assert.deepEqual(Object.keys(ins.expenses[0]).sort(),
    ['amount', 'category', 'note', 'spent_at', 'user_id']);
  assert.deepEqual(Object.keys(ins.learning_sessions[0]).sort(),
    ['learned_on', 'link', 'source', 'title', 'user_id', 'verdict']);

  // source marks where the row came from, so a bad parser run can be found and
  // undone later without guessing which rows were typed by hand.
  assert.equal(ins.meals[0].source, 'quick-log');
  assert.equal(ins.sleep[0].source, 'quick-log');
});

test('an empty parse produces no inserts at all', () => {
  const ins = toInserts([], 'user-1');
  assert.deepEqual(ins, { meals: [], sleep: [], expenses: [], learning_sessions: [] });
});
