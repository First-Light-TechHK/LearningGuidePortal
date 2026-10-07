// Retry only transport failures on this read-only readiness request. Invalid
// readiness, HTTP errors and malformed JSON must still fail the release.
export function isTransientReadFailure(error) {
  return error?.name === 'TimeoutError' ||
    (error instanceof TypeError && error.message === 'fetch failed') ||
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.cause?.code || error?.code);
}

export async function readReleaseHealth(origin, { request = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await request(`${origin}/api/health`, { signal: AbortSignal.timeout(30000) });
      const health = await response.json();
      if (!response.ok || health.ready !== true) throw new Error('Release health is not ready');
      return { health, attempts: attempt };
    } catch (error) {
      if (!isTransientReadFailure(error) || attempt === 3) throw error;
      await wait(attempt * 1000);
    }
  }
}
