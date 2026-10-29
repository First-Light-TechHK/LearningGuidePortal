// Portal -> Admin client for the Admin-owned Helpdesk FAQs and the AI
// Support Assistant (tickets-v2-figma-addendum §2). Admin is the single
// writer of FAQs and suggestions; Portal only reads published FAQs, asks for
// a suggestion and reports outcomes. Every call is best effort: no learner
// page or submit ever waits long on, or fails because of, Admin.
// ADMIN_HELPDESK_BASE_URL and ADMIN_HELPDESK_TOKEN are read on every call so
// a rotated token applies without a restart. The token is never logged.
import { FAQ_CATEGORIES, type AdminSuggestRequest, type AssistFeedback, type FaqCategory, type FaqFilter, type HelpFaq, type HelpdeskLocale, type HelpdeskSuggestion } from "@/contracts/helpdesk";
import { isUuid } from "@/lib/uuidv7";

export const ADMIN_FAQS_TTL_MS = 60_000;
export const ADMIN_FAQS_TIMEOUT_MS = 3_000;
/** How long a page waits for Admin when nothing is cached; after that it renders without the data and the answer, when it comes, is cached. */
export const ADMIN_FAQS_WAIT_MS = 500;
/** After a failed fetch, no new request for this long (stale or hidden meanwhile), so an outage costs one request per window, not one per page load. */
export const ADMIN_FAQS_RETRY_MS = 15_000;
/** Distinct FAQ queries kept per kind (lists; searches and deep links); the oldest entry of that kind goes first. */
export const ADMIN_FAQS_CACHE_ENTRIES = 200;
/**
 * Uncached searches (?q=) and deep links (?faq=) asked of Admin per minute by
 * this instance. The Help Centre is public, so every new value would
 * otherwise be one Admin search; over the budget the page shows what is
 * cached or the static fallback until the minute has passed.
 */
export const ADMIN_SEARCHES_PER_MINUTE = 120;
const SEARCH_WINDOW_MS = 60_000;
export const ADMIN_SUGGEST_TIMEOUT_MS = 4_000;
export const ADMIN_OUTCOME_TIMEOUT_MS = 4_000;

type CacheEntry<T> = { etag: string | null; value: T; fetchedAt: number };
/** Popular, category and full lists: few distinct keys. */
const listCache = new Map<string, CacheEntry<HelpFaq[] | HelpFaq | null>>();
/** Searches and single FAQs: one key per value a visitor types or links, so they can never push the lists out. */
const searchCache = new Map<string, CacheEntry<HelpFaq[] | HelpFaq | null>>();
/** One request per base URL + query at a time. */
const faqsInFlight = new Map<string, Promise<HelpFaq[] | HelpFaq | null | undefined>>();
/** Last failure per key, bounded like the caches (oldest goes first). */
const faqsFailedAt = new Map<string, number>();
/** Start times of uncached searches and deep links in the last minute. */
const searchStarts: number[] = [];
let throttledLoggedAt = -Infinity;

/** Test hook and operational reset: forget every cached FAQ answer. */
export function clearFaqCache() {
  listCache.clear();
  searchCache.clear();
  faqsInFlight.clear();
  faqsFailedAt.clear();
  searchStarts.length = 0;
  throttledLoggedAt = -Infinity;
}

/** Test and ops hook: how many entries each bounded map holds. */
export function faqCacheSizes() {
  return { lists: listCache.size, searches: searchCache.size, failed: faqsFailedAt.size };
}

const isSearchPath = (path: string) => /[?&]q=/.test(path) || /\/faqs\/[^/?]+\?/.test(path);
const cacheFor = (path: string) => (isSearchPath(path) ? searchCache : listCache);

function bounded<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  map.set(key, value);
  while (map.size > ADMIN_FAQS_CACHE_ENTRIES) map.delete(map.keys().next().value as string);
}

/** The value, or undefined when it is not there within ms (the work itself goes on). */
function within<T>(work: Promise<T | undefined>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export type AdminHelpdeskClientDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
  timeouts?: Partial<{ faqs: number; wait: number; suggest: number; outcome: number }>;
};

type Target = { baseUrl: string; token: string };

function target(): Target | null {
  const raw = process.env.ADMIN_HELPDESK_BASE_URL?.trim();
  const token = process.env.ADMIN_HELPDESK_TOKEN?.trim();
  if (!raw || !token) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { baseUrl: url.toString().replace(/\/+$/, ""), token };
  } catch {
    return null;
  }
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A published FAQ as Admin sends it; anything malformed (or an unknown category) is dropped. */
function faqOf(value: unknown): HelpFaq | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!isUuid(item.id) || !isText(item.question) || !isText(item.answer)) return null;
  if (typeof item.category !== "string" || !(FAQ_CATEGORIES as readonly string[]).includes(item.category)) return null;
  return { id: item.id.toLowerCase(), category: item.category as FaqCategory, popular: item.popular === true, question: item.question, answer: item.answer, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "" };
}

function suggestion(value: unknown): HelpdeskSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!isUuid(item.id) || !isUuid(item.faqId) || !isText(item.question) || !isText(item.answer)) return null;
  return { id: item.id.toLowerCase(), faqId: item.faqId.toLowerCase(), question: item.question, answer: item.answer };
}

/** The list query in a fixed order (locale, popular, category, q, limit). */
export function faqsPath(locale: HelpdeskLocale, filter: FaqFilter = {}) {
  const query = new URLSearchParams({ locale });
  if (filter.popular) query.set("popular", "true");
  if (filter.category) query.set("category", filter.category);
  // One cache key (and one Admin search) per search, whatever its case or spacing.
  const q = filter.q?.replace(/\s+/g, " ").trim().toLowerCase();
  if (q) query.set("q", q);
  if (filter.limit) query.set("limit", String(Math.min(100, Math.max(1, Math.floor(filter.limit)))));
  return `/api/integration/helpdesk/faqs?${query}`;
}

export function createAdminHelpdeskClient(deps: AdminHelpdeskClientDeps = {}) {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  const timeouts = { faqs: ADMIN_FAQS_TIMEOUT_MS, wait: ADMIN_FAQS_WAIT_MS, suggest: ADMIN_SUGGEST_TIMEOUT_MS, outcome: ADMIN_OUTCOME_TIMEOUT_MS, ...deps.timeouts };

  async function call(destination: Target, path: string, init: { method: "GET" | "POST"; body?: unknown; headers?: Record<string, string>; timeout: number }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), init.timeout);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${destination.token}`, Accept: "application/json", ...init.headers };
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await doFetch(`${destination.baseUrl}${path}`, {
        method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: controller.signal, cache: "no-store"
      });
      // Read the body inside the timeout as well.
      const text = response.status === 204 || response.status === 304 ? "" : await response.text();
      return { status: response.status, etag: response.headers.get("etag"), text };
    } finally {
      clearTimeout(timer);
    }
  }

  function failure(event: string, error: unknown, extra: Record<string, unknown> = {}) {
    log({ type: "helpdesk", event, reason: error instanceof Error ? (error.message === "timeout" ? "timeout" : error.name) : String(error), ...extra });
  }

  /** undefined = Admin could not answer (keep / hide); null = a single FAQ that does not exist (404). */
  async function fetchFaqs(destination: Target, key: string, path: string, single: boolean): Promise<HelpFaq[] | HelpFaq | null | undefined> {
    const cache = cacheFor(path);
    const remember = (entryKey: string, entry: CacheEntry<HelpFaq[] | HelpFaq | null>) => bounded(cache, entryKey, entry);
    const cached = cache.get(key);
    try {
      const result = await call(destination, path, { method: "GET", timeout: timeouts.faqs, headers: cached?.etag ? { "If-None-Match": cached.etag } : {} });
      if (result.status === 304 && cached) {
        remember(key, { ...cached, fetchedAt: now() });
        faqsFailedAt.delete(key);
        return cached.value;
      }
      if (single && result.status === 404) {
        remember(key, { etag: null, value: null, fetchedAt: now() });
        faqsFailedAt.delete(key);
        return null;
      }
      if (result.status !== 200) throw new Error(`status_${result.status}`);
      const body = JSON.parse(result.text) as { faqs?: unknown; faq?: unknown; etag?: unknown };
      let value: HelpFaq[] | HelpFaq | null;
      if (single) {
        // Tolerant reader: the FAQ itself, or wrapped as { faq }.
        value = faqOf(body.faq ?? body);
        if (!value) throw new Error("malformed");
      } else {
        if (!Array.isArray(body.faqs)) throw new Error("malformed");
        value = body.faqs.map(faqOf).filter((item): item is HelpFaq => Boolean(item));
      }
      const etag = result.etag || (typeof body.etag === "string" ? body.etag : null);
      remember(key, { etag, value, fetchedAt: now() });
      faqsFailedAt.delete(key);
      return value;
    } catch (error) {
      failure("admin_faqs_failed", error, { stale: Boolean(cached) });
      bounded(faqsFailedAt, key, now());
      return cached ? cached.value : undefined;
    }
  }

  /**
   * Shared read path for FAQ lists and single FAQs. Never holds a page on
   * Admin: a fresh copy is returned as is, a stale copy at once while it is
   * revalidated in the background, and with nothing cached the caller waits
   * at most waitMs (the request goes on and its answer is cached for the
   * next load). After a failure Admin is not asked again for
   * ADMIN_FAQS_RETRY_MS.
   */
  async function read(path: string, single: boolean, waitMs: number | undefined): Promise<HelpFaq[] | HelpFaq | null | undefined> {
    const destination = target();
    if (!destination) return undefined;
    const key = `${destination.baseUrl}|${path}`;
    const cached = cacheFor(path).get(key);
    if (cached && now() - cached.fetchedAt < ADMIN_FAQS_TTL_MS) return cached.value;
    const failedAt = faqsFailedAt.get(key);
    if (failedAt !== undefined && now() - failedAt < ADMIN_FAQS_RETRY_MS) return cached ? cached.value : undefined;
    let pending = faqsInFlight.get(key);
    if (!pending && !cached && isSearchPath(path)) {
      const at = now();
      while (searchStarts.length && at - searchStarts[0] >= SEARCH_WINDOW_MS) searchStarts.shift();
      if (searchStarts.length >= ADMIN_SEARCHES_PER_MINUTE) {
        if (at - throttledLoggedAt >= SEARCH_WINDOW_MS) {
          throttledLoggedAt = at;
          log({ type: "helpdesk", event: "admin_faqs_throttled", perMinute: ADMIN_SEARCHES_PER_MINUTE });
        }
        return undefined;
      }
      searchStarts.push(at);
    }
    if (!pending) {
      pending = fetchFaqs(destination, key, path, single).finally(() => faqsInFlight.delete(key));
      faqsInFlight.set(key, pending);
    }
    if (cached) return cached.value;
    return within(pending, waitMs ?? timeouts.wait);
  }

  /** Published FAQs for the locale (popular first, then newest, as Admin orders them); null means Admin is unavailable and nothing is cached. */
  async function faqs(locale: HelpdeskLocale, filter: FaqFilter = {}, options: { waitMs?: number } = {}): Promise<HelpFaq[] | null> {
    const value = await read(faqsPath(locale, filter), false, options.waitMs);
    return Array.isArray(value) ? value : null;
  }

  /** One published FAQ (the Help Centre ?faq= deep link), or null when it does not exist or Admin is unavailable. */
  async function faq(id: string, locale: HelpdeskLocale, options: { waitMs?: number } = {}): Promise<HelpFaq | null> {
    if (!isUuid(id)) return null;
    const value = await read(`/api/integration/helpdesk/faqs/${encodeURIComponent(id.toLowerCase())}?${new URLSearchParams({ locale })}`, true, options.waitMs);
    return value && !Array.isArray(value) ? value : null;
  }

  /**
   * One stored answer, or null (no match, not configured, error or the 4 s
   * timeout). source says where it is shown: the submit-time modal, the chat
   * panel, or a starter chip (with faqId, which Admin returns directly).
   */
  async function suggest(input: AdminSuggestRequest): Promise<HelpdeskSuggestion | null> {
    const destination = target();
    if (!destination) return null;
    try {
      // Fixed key order; optional fields only when set.
      const body: Record<string, string> = { learnerId: input.learnerId, locale: input.locale, source: input.source };
      if (input.category) body.category = input.category;
      if (input.subject) body.subject = input.subject;
      body.message = input.message;
      if (input.faqId) body.faqId = input.faqId;
      const result = await call(destination, "/api/integration/helpdesk/suggest", { method: "POST", timeout: timeouts.suggest, body });
      if (result.status !== 200) throw new Error(`status_${result.status}`);
      const reply = JSON.parse(result.text) as { suggestion?: unknown };
      if (reply.suggestion === null) return null;
      const parsed = suggestion(reply.suggestion);
      if (!parsed) throw new Error("malformed");
      return parsed;
    } catch (error) {
      failure("admin_suggest_failed", error);
      return null;
    }
  }

  /** Report what the learner did with a suggestion; true when Admin accepted it. */
  async function reportOutcome(suggestionId: string, outcome: AssistFeedback): Promise<boolean> {
    const destination = target();
    if (!destination) return false;
    try {
      const result = await call(destination, `/api/integration/helpdesk/suggestions/${encodeURIComponent(suggestionId)}/outcome`, { method: "POST", timeout: timeouts.outcome, body: { outcome } });
      if (result.status < 200 || result.status >= 300) throw new Error(`status_${result.status}`);
      return true;
    } catch (error) {
      failure("admin_outcome_failed", error, { outcome });
      return false;
    }
  }

  return { faqs, faq, suggest, reportOutcome };
}

export type AdminHelpdeskClient = ReturnType<typeof createAdminHelpdeskClient>;
