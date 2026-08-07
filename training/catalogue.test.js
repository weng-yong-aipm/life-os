import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muscleList, byMuscle, search, mediaFor } from './catalogue.js';

const EXERCISES = [
  { name: 'Barbell Curl', category: 'strength', primaryMuscles: ['biceps'], met: 5 },
  { name: 'Barbell Squat', category: 'strength', primaryMuscles: ['quadriceps', 'glutes'], met: 6 },
  { name: '3/4 Sit-Up', category: 'strength', primaryMuscles: ['abdominals'], met: 5 },
];

const MEDIA = [
  { exercise: 'Barbell Squat', path: 'barbell-squat/1.jpg', license: 'CC0', licenseAuthor: 'wger.de contributors', sourceUrl: 'https://wger.de/en/exercise/1/view/' },
];

test('muscleList returns every distinct primary muscle, sorted', () => {
  assert.deepEqual(muscleList(EXERCISES), ['abdominals', 'biceps', 'glutes', 'quadriceps']);
});

test('byMuscle filters to exercises whose primaryMuscles includes the muscle', () => {
  const result = byMuscle(EXERCISES, 'quadriceps');
  assert.deepEqual(result.map((e) => e.name), ['Barbell Squat']);
});

test('byMuscle is case-insensitive', () => {
  const result = byMuscle(EXERCISES, 'BICEPS');
  assert.deepEqual(result.map((e) => e.name), ['Barbell Curl']);
});

test('byMuscle with no muscle returns everything unfiltered', () => {
  assert.equal(byMuscle(EXERCISES, '').length, EXERCISES.length);
  assert.equal(byMuscle(EXERCISES, null).length, EXERCISES.length);
});

test('search matches a substring of the name, case-insensitive', () => {
  const result = search(EXERCISES, 'barbell');
  assert.deepEqual(result.map((e) => e.name), ['Barbell Curl', 'Barbell Squat']);
});

test('search with punctuation in the name still matches', () => {
  const result = search(EXERCISES, 'sit-up');
  assert.deepEqual(result.map((e) => e.name), ['3/4 Sit-Up']);
});

test('search with no query returns everything unfiltered', () => {
  assert.equal(search(EXERCISES, '').length, EXERCISES.length);
});

test('mediaFor returns the matching record', () => {
  const record = mediaFor(MEDIA, 'Barbell Squat');
  assert.equal(record.path, 'barbell-squat/1.jpg');
});

test('mediaFor is case-insensitive on the exercise name', () => {
  const record = mediaFor(MEDIA, 'barbell squat');
  assert.equal(record.path, 'barbell-squat/1.jpg');
});

test('mediaFor returns null when no image was mirrored for that exercise', () => {
  assert.equal(mediaFor(MEDIA, 'Barbell Curl'), null);
  assert.equal(mediaFor([], 'Barbell Squat'), null);
});
