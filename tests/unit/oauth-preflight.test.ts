// @ts-nocheck
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOAuthPreflight } from '../../scripts/release/oauth-preflight.mjs';

const origin = 'https://uat.example.test';
function stub({ callbackOrigin = origin, providerPage, mutateStart, startFailure = false } = {}) {
  const seen = [];
  return { seen, request: async (path, options = {}) => {
    seen.push({ path, options });
    if (path.startsWith('/api/auth/')) {
      if (startFailure) throw new Error('SECRET internal detail');
      const google = path.includes('/google');
      const url = new URL(google ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://open.weixin.qq.com/connect/qrconnect');
      url.search = new URLSearchParams({ [google ? 'client_id' : 'appid']: 'test-client', state: 'SECRET', redirect_uri: `${callbackOrigin}/api/auth/${google ? 'google' : 'wechat'}/callback` }).toString();
      mutateStart?.(url);
      return { status: 307, headers: new Headers({ location: url.href }) };
    }
    if (providerPage instanceof Error) throw providerPage;
    return providerPage || { status: 200, url: 'https://accounts.google.com/v3/signin/identifier', text: 'Sign in' };
  } };
}

test('preflight reaches Google without claiming completed sign-in or verified WeChat', async () => {
  const { request, seen } = stub();
  const result = await checkOAuthPreflight(origin, request);
  assert.equal(result.ok, true);
  assert.equal(result.checks.google.status, 'authorisation-page-reached');
  assert.equal(result.checks.wechat.status, 'redirect-only-not-verified');
  assert.ok(result.exclusions.length);
  assert.equal(seen.filter(item => item.path.startsWith('https://open.weixin.qq.com')).length, 0);
  assert.ok(seen.every(item => !item.options.body));
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

test('Google HTTP 200 error page is rejected even when it also contains Sign in', async () => {
  const result = await checkOAuthPreflight(origin, stub({ providerPage: {
    status: 200, url: 'https://accounts.google.com/signin/oauth/error?authError=SECRET', text: 'Sign in Access blocked: Error 400: redirect_uri_mismatch'
  } }).request);
  assert.equal(result.ok, false);
  assert.equal(result.checks.google.status, 'rejected');
  assert.match(result.failures.join(), /redirect_uri_mismatch/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

test('provider error URL fails even when the error text is localised', async () => {
  const result = await checkOAuthPreflight(origin, stub({ providerPage: { status: 200, url: 'https://accounts.google.com/signin/oauth/error', text: 'localised error' } }).request);
  assert.equal(result.ok, false);
  assert.equal(result.checks.google.providerError, 'authorisation_error');
});

test('UAT must never redirect back to SIT, even with a shared provider client', async () => {
  const { request, seen } = stub({ callbackOrigin: 'https://sit.example.test' });
  const result = await checkOAuthPreflight(origin, request);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => item.startsWith('google.callback:')));
  assert.ok(result.failures.some(item => item.startsWith('wechat.callback:')));
  assert.equal(seen.length, 2);
});

test('callback comparison includes exact path and query, not just hostname', async () => {
  for (const suffix of ['/', '?environment=sit']) {
    const result = await checkOAuthPreflight(origin, stub({ mutateStart: url => url.searchParams.set('redirect_uri', url.searchParams.get('redirect_uri') + suffix) }).request);
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 2);
  }
});

test('unknown provider pages, outages and challenges cannot become green checks', async () => {
  for (const providerPage of [
    { status: 503, url: 'https://accounts.google.com/v3/signin/identifier', text: 'Sign in' },
    { status: 200, url: 'https://accounts.google.com/challenge', text: 'Sign in' },
    { status: 200, url: 'https://elsewhere.example/v3/signin/identifier', text: 'Sign in' },
    { status: 200, text: 'Sign in' },
    new Error('SECRET transport')
  ]) {
    const result = await checkOAuthPreflight(origin, stub({ providerPage }).request);
    assert.equal(result.ok, false);
    assert.equal(result.checks.google.status, 'unverified');
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});

test('unsafe provider URLs and absent client or state fail before making a provider request', async () => {
  for (const mutateStart of [
    url => { url.protocol = 'http:'; },
    url => { url.hostname += '.evil.test'; },
    url => { url.username = 'SECRET'; },
    url => { url.pathname = '/wrong'; },
    url => { url.searchParams.delete('state'); },
    url => { url.searchParams.delete('client_id'); url.searchParams.delete('appid'); }
  ]) {
    const { request, seen } = stub({ mutateStart });
    const result = await checkOAuthPreflight(origin, request);
    assert.equal(result.ok, false);
    assert.equal(seen.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});

test('application request failures are reported without credential details', async () => {
  const result = await checkOAuthPreflight(origin, stub({ startFailure: true }).request);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
