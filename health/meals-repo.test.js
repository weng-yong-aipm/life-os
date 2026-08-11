import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functionErrorText } from './meals-repo.js';

/* supabase-js collapses every non-2xx from an Edge Function into one sentence
 * and leaves the real cause in the undrained Response on error.context. On a
 * phone that sentence is the entire diagnosis the user gets, and it names no
 * cause — so a missing ANTHROPIC_API_KEY looked identical to "this photo isn't
 * food", and the only visible recourse was typing the calories in by hand. */

const resWith = (text) => ({ text: async () => text });

test('surfaces the function error and detail from the response body', async () => {
  const err = {
    message: 'Edge Function returned a non-2xx status code',
    context: resWith(JSON.stringify({ error: 'claude request failed', detail: 'invalid x-api-key' })),
  };
  assert.equal(await functionErrorText(err), 'claude request failed — invalid x-api-key');
});

test('uses the error alone when the function sent no detail', async () => {
  const err = { message: 'non-2xx', context: resWith(JSON.stringify({ error: 'missing auth' })) };
  assert.equal(await functionErrorText(err), 'missing auth');
});

test('falls back to the raw body when it is not JSON', async () => {
  const err = { message: 'non-2xx', context: resWith('502 Bad Gateway') };
  assert.equal(await functionErrorText(err), 'non-2xx — 502 Bad Gateway');
});

test('keeps the generic sentence when there is nothing better', async () => {
  assert.equal(await functionErrorText({ message: 'boom' }), 'boom');
  assert.equal(await functionErrorText({ message: 'boom', context: resWith('   ') }), 'boom');
  assert.equal(await functionErrorText({ message: 'boom', context: resWith(JSON.stringify({})) }), 'boom');
});

test('a body that cannot be read does not replace the error with a crash', async () => {
  // Reading an already-consumed Response throws; the user must still get the
  // sentence rather than an unhandled rejection inside the catch path.
  const err = { message: 'boom', context: { text: async () => { throw new Error('body used already'); } } };
  assert.equal(await functionErrorText(err), 'boom');
});

test('truncates a runaway detail instead of flooding the status line', async () => {
  const err = { message: 'non-2xx', context: resWith(JSON.stringify({ error: 'e', detail: 'x'.repeat(1000) })) };
  const out = await functionErrorText(err);
  assert.equal(out.length, 300);
});
