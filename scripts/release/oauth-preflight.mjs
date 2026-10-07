const providers = {
  google: { host: 'accounts.google.com', path: '/o/oauth2/v2/auth', client: 'client_id' },
  wechat: { host: 'open.weixin.qq.com', path: '/connect/qrconnect', client: 'appid' }
};
const redirects = [302, 303, 307, 308];

function parseUrl(value) {
  try { return new URL(value); } catch { return null; }
}

// No account credentials or consent are submitted. Reaching a login page is
// only a provider preflight, never evidence of a completed OAuth callback.
export async function checkOAuthPreflight(origin, request) {
  const failures = [], checks = {};
  for (const [provider, expected] of Object.entries(providers)) {
    const callback = new URL(`/api/auth/${provider}/callback`, origin).href;
    checks[provider] = { status: 'unverified', callback };
    let start;
    try { start = await request(`/api/auth/${provider}?locale=en-GB`, { redirect: 'manual' }); }
    catch {
      failures.push(`${provider}.redirect: application request failed`);
      continue;
    }
    const auth = parseUrl(start.headers?.get?.('location'));
    if (!redirects.includes(start.status) || !auth || auth.protocol !== 'https:' || auth.host !== expected.host || auth.pathname !== expected.path || auth.username || auth.password) {
      failures.push(`${provider}.redirect: expected an HTTPS redirect to the provider authorisation endpoint`);
      continue;
    }
    if (auth.searchParams.get('redirect_uri') !== callback) {
      failures.push(`${provider}.callback: expected ${callback}`);
      continue;
    }
    if (!auth.searchParams.get(expected.client) || !auth.searchParams.get('state')) {
      failures.push(`${provider}.redirect: client identity or OAuth state missing`);
      continue;
    }
    if (provider !== 'google') {
      checks[provider].status = 'redirect-only-not-verified';
      continue;
    }
    let page;
    try { page = await request(auth.href); }
    catch {
      failures.push('google.authorisation: provider request failed; acceptance not verified');
      continue;
    }
    const landed = parseUrl(page.url);
    const providerError = /\b(redirect_uri_mismatch|invalid_client|deleted_client|invalid_request|access_denied|org_internal)\b/.exec(page.text || '')?.[1];
    if (providerError || landed?.pathname.includes('/oauth/error')) {
      checks.google.status = 'rejected';
      checks.google.providerError = providerError || 'authorisation_error';
      failures.push(`google.authorisation: ${checks.google.providerError} for ${callback}`);
    } else if (page.status === 200 && landed?.origin === 'https://accounts.google.com' && /^\/v[23]\/signin\/(identifier|accountchooser)\/?$/.test(landed.pathname)) {
      checks.google.status = 'authorisation-page-reached';
    } else {
      failures.push('google.authorisation: recognised Google sign-in page not reached; acceptance not verified');
    }
  }
  return { ok: failures.length === 0, failures, checks, exclusions: ['Google sign-in completion and WeChat provider acceptance/completion require real account testing.'] };
}
