// @ts-nocheck -- release tooling is intentionally executable plain ESM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readReleaseHealth } from '../../scripts/release/health-read.mjs';

test('release health retries bounded network failures without changing the target or validation', async () => {
  const calls = [], delays = [];
  const health = { ready: true, environment: 'UAT', version: 'expected' };
  const result = await readReleaseHealth('https://uat.example.test', {
    request: async (url, options) => {
      calls.push(url);
      assert.ok(options.signal);
      if (calls.length < 3) throw new TypeError('fetch failed');
      return { ok: true, json: async () => health };
    }, wait: async ms => delays.push(ms),
  });
  assert.deepEqual(result, { health, attempts: 3 });
  assert.deepEqual(calls, Array(3).fill('https://uat.example.test/api/health'));
  assert.deepEqual(delays, [1000, 2000]);
});

test('unhealthy responses, HTTP failures and malformed JSON are not retried or accepted', async () => {
  for (const response of [
    { ok: true, json: async () => ({ ready: false }) },
    { ok: false, json: async () => ({ ready: true }) },
    { ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } },
  ]) {
    let calls = 0;
    await assert.rejects(readReleaseHealth('https://uat.example.test', {
      request: async () => { calls++; return response; },
      wait: async () => assert.fail('Must not retry application failures'),
    }));
    assert.equal(calls, 1);
  }
});

test('persistent transport failure fails after three attempts', async () => {
  let calls = 0;
  await assert.rejects(readReleaseHealth('https://uat.example.test', {
    request: async () => { calls++; throw new TypeError('fetch failed'); }, wait: async () => {},
  }), /fetch failed/);
  assert.equal(calls, 3);
});
