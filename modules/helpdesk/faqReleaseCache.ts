// Helpdesk v5 (helpdesk-v5-faq-graph-design.md §4 "Caching"): Portal's
// in-memory copy of Admin's published FAQ release, per locale. It is what the
// chat renders clicks from and checks click edges against, so a click never
// asks the model or Admin. Revalidated at most every 60 s with If-None-Match
// (304 = unchanged); on any failure the last good release is kept, so clicks
// keep working while Admin is down. "none" (404: Admin has no release yet, or
// an older Admin without the route) means the per-FAQ published list is used,
// as before v5.
import type { FaqEdge, FaqNode, FaqRelease, HelpdeskLocale } from "@/contracts/helpdesk";
import type { FaqReleaseRead } from "./adminClient";

export const FAQ_RELEASE_TTL_MS = 60_000;
/** After a failed revalidation, no new request for this long (the last good release is served meanwhile). */
export const FAQ_RELEASE_RETRY_MS = 15_000;
/** How long a caller waits when nothing is cached yet (the request goes on in the background). */
export const FAQ_RELEASE_WAIT_MS = 3_000;

export type FaqReleaseSource = { faqRelease(locale: HelpdeskLocale, ifNoneMatch?: string | null): Promise<FaqReleaseRead> };

type Entry = { release: FaqRelease | null; etag: string | null; checkedAt: number; failedAt: number | null; known: boolean };

export type FaqReleaseCacheDeps = { now?: () => number; ttlMs?: number; retryMs?: number; log?: (line: Record<string, unknown>) => void };

/** One graph view of a release: nodes by id and the edges under each parent, by position. */
export type ReleaseGraph = { release: FaqRelease; node(id: string): FaqNode | null; children(parentId: string): FaqEdge[]; edge(parentId: string, childId: string): FaqEdge | null };

export function releaseGraph(release: FaqRelease): ReleaseGraph {
  const nodes = new Map(release.nodes.map((node) => [node.id, node]));
  const byParent = new Map<string, FaqEdge[]>();
  for (const edge of release.edges) byParent.set(edge.parentId, [...(byParent.get(edge.parentId) ?? []), edge]);
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position || (a.childId < b.childId ? -1 : 1));
  return {
    release,
    node: (id) => nodes.get(id.toLowerCase()) ?? null,
    children: (parentId) => byParent.get(parentId.toLowerCase()) ?? [],
    edge: (parentId, childId) => (byParent.get(parentId.toLowerCase()) ?? []).find((edge) => edge.childId === childId.toLowerCase()) ?? null
  };
}

export function createFaqReleaseCache(deps: FaqReleaseCacheDeps = {}) {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? FAQ_RELEASE_TTL_MS;
  const retryMs = deps.retryMs ?? FAQ_RELEASE_RETRY_MS;
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  const entries = new Map<HelpdeskLocale, Entry>();
  const inFlight = new Map<HelpdeskLocale, Promise<void>>();

  async function revalidate(source: FaqReleaseSource, locale: HelpdeskLocale): Promise<void> {
    const entry = entries.get(locale);
    const read = await source.faqRelease(locale, entry?.release ? entry.etag : null).catch((): FaqReleaseRead => ({ status: "unavailable" }));
    const at = now();
    if (read.status === "ok") {
      if (entry?.release && read.release.version < entry.release.version) log({ type: "helpdesk", event: "faq_release_older", from: entry.release.version, to: read.release.version });
      entries.set(locale, { release: read.release, etag: read.etag, checkedAt: at, failedAt: null, known: true });
    } else if (read.status === "not_modified" && entry?.release) {
      entries.set(locale, { ...entry, checkedAt: at, failedAt: null });
    } else if (read.status === "none") {
      // Admin says there is no release (yet, or it went back to per-FAQ publishing): use the per-FAQ list.
      entries.set(locale, { release: null, etag: null, checkedAt: at, failedAt: null, known: true });
    } else {
      // Unavailable (or a 304 for a release this instance no longer holds): keep what is there.
      entries.set(locale, { release: entry?.release ?? null, etag: entry?.etag ?? null, checkedAt: entry?.checkedAt ?? 0, failedAt: at, known: entry?.known ?? false });
      log({ type: "helpdesk", event: "faq_release_stale", locale, cached: entry?.release?.version ?? null });
    }
  }

  function start(source: FaqReleaseSource, locale: HelpdeskLocale): Promise<void> {
    let pending = inFlight.get(locale);
    if (!pending) {
      pending = revalidate(source, locale).finally(() => inFlight.delete(locale));
      inFlight.set(locale, pending);
    }
    return pending;
  }

  /**
   * The release to use now, or null for "no release: use the per-FAQ list" (also while nothing could be read yet).
   * A fresh copy is returned at once; a stale one at once while it is revalidated in the background, unless
   * minVersion says Admin already answered from a newer release (then the caller waits for it, at most waitMs).
   */
  async function current(source: FaqReleaseSource, locale: HelpdeskLocale, options: { waitMs?: number; minVersion?: number | null } = {}): Promise<FaqRelease | null> {
    const entry = entries.get(locale);
    const at = now();
    const fresh = entry?.known && at - entry.checkedAt < ttlMs;
    const behind = Boolean(options.minVersion && (!entry?.release || entry.release.version < options.minVersion));
    const resting = entry?.failedAt !== null && entry?.failedAt !== undefined && at - entry.failedAt < retryMs;
    if ((fresh && !behind) || resting) return entry?.release ?? null;
    const pending = start(source, locale);
    if (entry?.known && !behind) return entry.release;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([pending, new Promise<void>((resolve) => { timer = setTimeout(resolve, options.waitMs ?? FAQ_RELEASE_WAIT_MS); })]).finally(() => clearTimeout(timer));
    return entries.get(locale)?.release ?? null;
  }

  return {
    current,
    /** Test and ops hook: forget every cached release. */
    clear() { entries.clear(); inFlight.clear(); }
  };
}

export type FaqReleaseCache = ReturnType<typeof createFaqReleaseCache>;

/** The instance's one cache (module scope, like the FAQ list cache in adminClient.ts). */
export const sharedFaqReleaseCache = createFaqReleaseCache();
