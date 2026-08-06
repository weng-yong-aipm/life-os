import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateStr } from './local-date.js';

test('localDateStr formats a date as local YYYY-MM-DD', () => {
  //构造一个本地时间的日期，避免依赖运行环境的时区
  const d = new Date(2026, 7, 5, 12, 0, 0); // 2026-08-05 12:00 local
  assert.equal(localDateStr(d), '2026-08-05');
});

test('localDateStr reads the local calendar date at an early-morning time', () => {
  // 07:30 local on Aug 5 — the exact window the UTC bug misfiled. East of UTC
  // this instant is still Aug 4 in UTC, so toISOString().slice(0,10) would say
  // 2026-08-04. This must say 2026-08-05 in every timezone.
  const d = new Date(2026, 7, 5, 7, 30, 0);
  assert.equal(localDateStr(d), '2026-08-05');
});

test('localDateStr zero-pads month and day', () => {
  const d = new Date(2026, 0, 9, 15, 0, 0); // 2026-01-09
  assert.equal(localDateStr(d), '2026-01-09');
});

test('localDateStr defaults to now and returns a well-formed string', () => {
  assert.match(localDateStr(), /^\d{4}-\d{2}-\d{2}$/);
});
