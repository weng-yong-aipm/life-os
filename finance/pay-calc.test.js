import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDay, calculatePay } from './pay-calc.js';

test('classifyDay: known holiday date returns holiday even on a weekday', () => {
  const holidays = new Set(['2026-08-31']); // Monday, Merdeka Day
  assert.equal(classifyDay('2026-08-31', holidays), 'holiday');
});

test('classifyDay: holiday overlapping a weekend still returns holiday, not weekend', () => {
  const holidays = new Set(['2026-03-21']); // Saturday, Hari Raya Aidilfitri
  assert.equal(classifyDay('2026-03-21', holidays), 'holiday');
});

test('classifyDay: Saturday with no matching holiday returns weekend', () => {
  assert.equal(classifyDay('2026-07-11', new Set()), 'weekend');
});

test('classifyDay: weekday with no matching holiday returns workday', () => {
  assert.equal(classifyDay('2026-07-13', new Set()), 'workday');
});

test('calculatePay: workday uses base rate with no multiplier', () => {
  const settings = { baseHourlyRate: 20, weekendMultiplier: 1.5, holidayMultiplier: 2 };
  assert.equal(calculatePay({ hours: 8, dayType: 'workday', settings }), 160);
});

test('calculatePay: weekend applies weekend multiplier', () => {
  const settings = { baseHourlyRate: 20, weekendMultiplier: 1.5, holidayMultiplier: 2 };
  assert.equal(calculatePay({ hours: 8, dayType: 'weekend', settings }), 240);
});

test('calculatePay: holiday applies holiday multiplier', () => {
  const settings = { baseHourlyRate: 20, weekendMultiplier: 1.5, holidayMultiplier: 2 };
  assert.equal(calculatePay({ hours: 8, dayType: 'holiday', settings }), 320);
});

test('calculatePay: rounds to 2 decimal places', () => {
  const settings = { baseHourlyRate: 19.99, weekendMultiplier: 1.5, holidayMultiplier: 2 };
  assert.equal(calculatePay({ hours: 3, dayType: 'workday', settings }), 59.97);
});
