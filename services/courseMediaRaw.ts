import { s3HeadRaw } from "./persistence/s3";

export const RAW_MEDIA_EXTENSIONS = ["mp4", "webm", "mov", "png", "jpg", "jpeg", "pdf", "mp3", "m4a"] as const;
export const RAW_MEDIA_MISS_TTL_MS = 30_000;
export const RAW_MEDIA_HIT_TTL_MS = 10 * 60 * 1000;

const CONTENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type RawMediaCacheEntry = { promise: Promise<string | null>; expiresAt: number };
type RawMediaDeps = { head?: (key: string) => Promise<boolean>; now?: () => number };

const rawMediaKeys = new Map<string, RawMediaCacheEntry>();

/** Test seam: clear cached positive and negative lookups. */
export function resetRawCourseMediaCache() {
  rawMediaKeys.clear();
}

/**
 * Both hits and misses expire. A deleted/replaced raw object must be
 * re-discovered, and a stalled HEAD must not pin the asset forever. The first
 * extension is checked alone (the common hit), then the rest in parallel so a
 * stored-only upload pays one extra round trip, not nine.
 */
export async function findRawCourseMediaKey(courseId: string, assetId: string, deps: RawMediaDeps = {}): Promise<string | null> {
  if (!CONTENT_ID.test(courseId) || !ASSET_ID.test(assetId)) return null;
  const cacheKey = `${courseId}/${assetId}`;
  const clock = deps.now || Date.now;
  const now = clock();
  const cached = rawMediaKeys.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) rawMediaKeys.delete(cacheKey);
  const head = deps.head || s3HeadRaw;
  const keyFor = (extension: string) => `course-media/${courseId}/${assetId}.${extension}`;
  const promise = (async () => {
    const first = keyFor(RAW_MEDIA_EXTENSIONS[0]);
    if (await head(first)) return first;
    const rest = await Promise.all(RAW_MEDIA_EXTENSIONS.slice(1).map(async extension => {
      const key = keyFor(extension);
      return (await head(key)) ? key : null;
    }));
    return rest.find((key): key is string => Boolean(key)) ?? null;
  })();
  const entry: RawMediaCacheEntry = { promise, expiresAt: now + RAW_MEDIA_HIT_TTL_MS };
  rawMediaKeys.set(cacheKey, entry);
  promise.then(
    key => {
      if (rawMediaKeys.get(cacheKey) !== entry) return;
      if (!key) entry.expiresAt = clock() + RAW_MEDIA_MISS_TTL_MS;
    },
    () => { if (rawMediaKeys.get(cacheKey) === entry) rawMediaKeys.delete(cacheKey); },
  );
  return promise;
}
