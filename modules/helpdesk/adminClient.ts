// Portal -> Admin client for the Admin-owned Helpdesk FAQs and the AI
// Support Assistant (tickets-v2-figma-addendum §2). Admin is the single
// writer of FAQs and suggestions; Portal only reads published FAQs, asks for
// a suggestion and reports outcomes. Every call is best effort: no learner
// page or submit ever waits long on, or fails because of, Admin.
// ADMIN_HELPDESK_BASE_URL and ADMIN_HELPDESK_TOKEN are read on every call so
// a rotated token applies without a restart. The token is never logged.
// Every call carries a W3C traceparent: a child of the learner request's
// own (deps.traceparent) when that is valid, otherwise a new trace.
import { FAQ_CATEGORIES, FAQ_SIGNALS, HELPDESK_LIMITS, buildSuggestContext, parseFaqRelease, parseSuggestTurn, type AdminSuggestReply, type AdminSuggestRequest, type AssistFeedback, type FaqCategory, type FaqFilter, type FaqRelease, type HelpFaq, type HelpdeskAlternative, type HelpdeskLocale, type HelpdeskSuggestion } from "@/contracts/helpdesk";
import { outgoingTraceparent } from "@/lib/traceparent";
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
  /** The incoming request's traceparent header, continued on every Admin call. */
  traceparent?: string | null;
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
  // v5 Part A (contract v6): only the FAQ signals Portal knows, in chip priority order; [] from an older Admin.
  const signals = Array.isArray(item.signals) ? FAQ_SIGNALS.filter((signal) => (item.signals as unknown[]).includes(signal)) : [];
  return { id: item.id.toLowerCase(), category: item.category as FaqCategory, popular: item.popular === true, question: item.question, answer: item.answer, signals, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "" };
}

function suggestion(value: unknown): HelpdeskSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!isUuid(item.id) || !isUuid(item.faqId) || !isText(item.question) || !isText(item.answer)) return null;
  return { id: item.id.toLowerCase(), faqId: item.faqId.toLowerCase(), question: item.question, answer: item.answer };
}

/** Stored FAQ questions are at most 200 code points (helpdesk_assist_log.faq_question); an alternative is kept to the same. */
const ALTERNATIVE_QUESTION_MAX = 200;

/**
 * v3 §1: Admin's "You might be asking" list, read tolerantly. An older Admin
 * sends none; malformed items are dropped, each FAQ is kept once, at most
 * HELPDESK_LIMITS.alternativesMax, and none next to an answer.
 */
function alternativesOf(value: unknown, answered: boolean): HelpdeskAlternative[] {
  if (answered || !Array.isArray(value)) return [];
  const found: HelpdeskAlternative[] = [];
  for (const raw of value) {
    if (found.length >= HELPDESK_LIMITS.alternativesMax) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (!isUuid(item.faqId) || !isText(item.question) || !item.question.trim()) continue;
    const faqId = item.faqId.toLowerCase();
    if (found.some((entry) => entry.faqId === faqId)) continue;
    found.push({ faqId, question: [...item.question].slice(0, ALTERNATIVE_QUESTION_MAX).join("") });
  }
  return found;
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

/** v6: the published FAQ release of a locale (Admin, bearer). */
export function faqReleasePath(locale: HelpdeskLocale) {
  return `/api/integration/helpdesk/faq-release/current?${new URLSearchParams({ locale })}`;
}

export type FaqReleaseRead = { status: "ok"; release: FaqRelease; etag: string } | { status: "not_modified" } | { status: "none" } | { status: "unavailable" };

export function createAdminHelpdeskClient(deps: AdminHelpdeskClientDeps = {}) {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  const timeouts = { faqs: ADMIN_FAQS_TIMEOUT_MS, wait: ADMIN_FAQS_WAIT_MS, suggest: ADMIN_SUGGEST_TIMEOUT_MS, outcome: ADMIN_OUTCOME_TIMEOUT_MS, ...deps.timeouts };

  async function call(destination: Target, path: string, init: { method: "GET" | "POST"; body?: unknown; headers?: Record<string, string>; timeout: number }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), init.timeout);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${destination.token}`, Accept: "application/json", traceparent: outgoingTraceparent(deps.traceparent), ...init.headers };
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
   * One stored answer or none, and when there is none Admin's alternatives
   * (v3; [] from an older Admin). No match, not configured, an error, a
   * malformed body or the 4 s timeout are { suggestion: null, alternatives: [] }.
   * source says where it is shown: the submit-time modal, the chat panel, or
   * a starter chip (with faqId, which Admin returns directly).
   */
  async function suggestReply(input: AdminSuggestRequest): Promise<AdminSuggestReply> {
    const nothing: AdminSuggestReply = { suggestion: null, alternatives: [] };
    const destination = target();
    if (!destination) return nothing;
    try {
      // Fixed key order; optional fields only when set; the run ids always, last.
      const body: Record<string, string | string[] | null | Record<string, unknown>> = { learnerId: input.learnerId, locale: input.locale, source: input.source };
      if (input.category) body.category = input.category;
      if (input.subject) body.subject = input.subject;
      body.message = input.message;
      if (input.faqId) body.faqId = input.faqId;
      // v3: Admin refuses a malformed id or more than 20 with 400, which would lose the answer too.
      const shown = [...new Set((input.shownFaqIds ?? []).filter((id) => isUuid(id)).map((id) => id.toLowerCase()))].slice(0, HELPDESK_LIMITS.shownFaqIdsMax);
      if (shown.length) body.shownFaqIds = shown;
      // v6: the card on screen, the chat session and the learner's own earlier words (never learner data); an older Admin ignores it.
      if (input.context) body.context = buildSuggestContext(input.context);
      body.runId = input.runId;
      body.parentRunId = input.parentRunId;
      const result = await call(destination, "/api/integration/helpdesk/suggest", { method: "POST", timeout: timeouts.suggest, body });
      if (result.status !== 200) throw new Error(`status_${result.status}`);
      const reply = JSON.parse(result.text) as { suggestion?: unknown; alternatives?: unknown };
      // v6: Admin's turn fields when it sent them (only for a request with context); absent otherwise.
      const turn = parseSuggestTurn(reply);
      const withTurn = (answer: AdminSuggestReply): AdminSuggestReply => (turn ? { ...answer, turn } : answer);
      if (reply.suggestion === null) return withTurn({ suggestion: null, alternatives: alternativesOf(reply.alternatives, false) });
      const parsed = suggestion(reply.suggestion);
      if (!parsed) throw new Error("malformed");
      return withTurn({ suggestion: parsed, alternatives: [] });
    } catch (error) {
      failure("admin_suggest_failed", error);
      return nothing;
    }
  }

  /** The v2 view of suggestReply: the stored answer, or null. */
  async function suggest(input: AdminSuggestRequest): Promise<HelpdeskSuggestion | null> {
    return (await suggestReply(input)).suggestion;
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

  /**
   * v5 FAQ question trees (contract v6): one request for the published release of a locale. The cache (keep the last
   * good release, revalidate every 60 s with If-None-Match) belongs to the caller. "none" = Admin has no release yet
   * (404, also an older Admin without the route): use the per-FAQ list; "unavailable" = keep what is cached.
   */
  async function faqRelease(locale: HelpdeskLocale, ifNoneMatch?: string | null): Promise<FaqReleaseRead> {
    const destination = target();
    if (!destination) return { status: "unavailable" };
    try {
      const result = await call(destination, faqReleasePath(locale), { method: "GET", timeout: timeouts.faqs, headers: ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {} });
      if (result.status === 304) return { status: "not_modified" };
      if (result.status === 404) return { status: "none" };
      if (result.status !== 200) throw new Error(`status_${result.status}`);
      const release = parseFaqRelease(JSON.parse(result.text));
      if (!release || release.locale !== locale) throw new Error("malformed");
      return { status: "ok", release, etag: result.etag || `"v${release.version}"` };
    } catch (error) {
      failure("admin_faq_release_failed", error);
      return { status: "unavailable" };
    }
  }

  return { faqs, faq, suggest, suggestReply, reportOutcome, faqRelease };
}

export type AdminHelpdeskClient = ReturnType<typeof createAdminHelpdeskClient>;
