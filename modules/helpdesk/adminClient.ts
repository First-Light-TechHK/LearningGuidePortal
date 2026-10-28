// Portal -> Admin client for the Admin-owned Helpdesk Q&A (addendum §A/§C/§E).
// Admin is the single writer of Common Questions and suggestions; Portal only
// reads published questions and asks for a suggestion. Every call is best
// effort: the learner's submit must never wait on, or fail because of, Admin.
// ADMIN_HELPDESK_BASE_URL and ADMIN_HELPDESK_TOKEN are read on every call so
// a rotated token applies without a restart. The token is never logged.
import type { CommonQuestion, HelpdeskLocale, HelpdeskSuggestion, SuggestInput, SuggestionOutcome } from "@/contracts/helpdesk";

export const ADMIN_QUESTIONS_TTL_MS = 60_000;
export const ADMIN_QUESTIONS_TIMEOUT_MS = 3_000;
/** How long a page waits for Admin when nothing is cached; after that it renders without the column and the answer, when it comes, is cached. */
export const ADMIN_QUESTIONS_WAIT_MS = 500;
/** After a failed fetch, no new request for this long (stale or hidden meanwhile), so an outage costs one request per window, not one per page load. */
export const ADMIN_QUESTIONS_RETRY_MS = 15_000;
export const ADMIN_SUGGEST_TIMEOUT_MS = 4_000;
export const ADMIN_OUTCOME_TIMEOUT_MS = 4_000;

type CacheEntry = { etag: string | null; questions: CommonQuestion[]; fetchedAt: number };
const questionCache = new Map<string, CacheEntry>();
/** One request per base URL + locale at a time. */
const questionsInFlight = new Map<string, Promise<CommonQuestion[] | null>>();
const questionsFailedAt = new Map<string, number>();

/** Test hook and operational reset: forget every cached question list. */
export function clearCommonQuestionsCache() {
  questionCache.clear();
  questionsInFlight.clear();
  questionsFailedAt.clear();
}

/** The value, or null when it is not there within ms (the work itself goes on). */
function within<T>(work: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export type AdminHelpdeskClientDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
  timeouts?: Partial<{ questions: number; wait: number; suggest: number; outcome: number }>;
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

function question(value: unknown): CommonQuestion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!isText(item.id) || !isText(item.category) || !isText(item.question) || !isText(item.answer)) return null;
  return { id: item.id, category: item.category, question: item.question, answer: item.answer };
}

function suggestion(value: unknown): HelpdeskSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!isText(item.id) || !isText(item.qaId) || !isText(item.question) || !isText(item.answer)) return null;
  return { id: item.id, qaId: item.qaId, question: item.question, answer: item.answer };
}

export function createAdminHelpdeskClient(deps: AdminHelpdeskClientDeps = {}) {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  const timeouts = { questions: ADMIN_QUESTIONS_TIMEOUT_MS, wait: ADMIN_QUESTIONS_WAIT_MS, suggest: ADMIN_SUGGEST_TIMEOUT_MS, outcome: ADMIN_OUTCOME_TIMEOUT_MS, ...deps.timeouts };

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

  async function fetchQuestions(destination: Target, key: string, locale: HelpdeskLocale): Promise<CommonQuestion[] | null> {
    const cached = questionCache.get(key);
    try {
      const result = await call(destination, `/api/integration/helpdesk/questions?${new URLSearchParams({ locale, featured: "true" })}`, {
        method: "GET", timeout: timeouts.questions, headers: cached?.etag ? { "If-None-Match": cached.etag } : {}
      });
      if (result.status === 304 && cached) {
        questionCache.set(key, { ...cached, fetchedAt: now() });
        questionsFailedAt.delete(key);
        return cached.questions;
      }
      if (result.status !== 200) throw new Error(`status_${result.status}`);
      const body = JSON.parse(result.text) as { questions?: unknown; etag?: unknown };
      if (!Array.isArray(body.questions)) throw new Error("malformed");
      const questions = body.questions.map(question).filter((item): item is CommonQuestion => Boolean(item));
      const etag = result.etag || (typeof body.etag === "string" ? body.etag : null);
      questionCache.set(key, { etag, questions, fetchedAt: now() });
      questionsFailedAt.delete(key);
      return questions;
    } catch (error) {
      failure("admin_questions_failed", error, { locale, stale: Boolean(cached) });
      questionsFailedAt.set(key, now());
      return cached ? cached.questions : null;
    }
  }

  /**
   * Featured, published questions for the locale; null means "hide the column".
   * Never holds a page on Admin: a fresh copy is returned as is, a stale copy
   * is returned at once while it is revalidated in the background, and with
   * nothing cached the caller waits at most ADMIN_QUESTIONS_WAIT_MS (the
   * request goes on and its answer is cached for the next load). After a
   * failure Admin is not asked again for ADMIN_QUESTIONS_RETRY_MS.
   */
  async function commonQuestions(locale: HelpdeskLocale): Promise<CommonQuestion[] | null> {
    const destination = target();
    if (!destination) return null;
    const key = `${destination.baseUrl}|${locale}`;
    const cached = questionCache.get(key);
    if (cached && now() - cached.fetchedAt < ADMIN_QUESTIONS_TTL_MS) return cached.questions;
    const failedAt = questionsFailedAt.get(key);
    if (failedAt !== undefined && now() - failedAt < ADMIN_QUESTIONS_RETRY_MS) return cached ? cached.questions : null;
    let pending = questionsInFlight.get(key);
    if (!pending) {
      pending = fetchQuestions(destination, key, locale).finally(() => questionsInFlight.delete(key));
      questionsInFlight.set(key, pending);
    }
    if (cached) return cached.questions;
    return within(pending, timeouts.wait);
  }

  /** One stored answer that may solve the enquiry, or null (no match, not configured, error or the 4 s timeout). */
  async function suggest(input: SuggestInput & { learnerId: string }): Promise<HelpdeskSuggestion | null> {
    const destination = target();
    if (!destination) return null;
    try {
      const result = await call(destination, "/api/integration/helpdesk/suggest", {
        method: "POST", timeout: timeouts.suggest,
        body: { learnerId: input.learnerId, locale: input.locale, category: input.category, subject: input.subject, message: input.message }
      });
      if (result.status !== 200) throw new Error(`status_${result.status}`);
      const body = JSON.parse(result.text) as { suggestion?: unknown };
      if (body.suggestion === null) return null;
      const parsed = suggestion(body.suggestion);
      if (!parsed) throw new Error("malformed");
      return parsed;
    } catch (error) {
      failure("admin_suggest_failed", error);
      return null;
    }
  }

  /** Report what the learner did with a suggestion; true when Admin accepted it. */
  async function reportOutcome(suggestionId: string, outcome: SuggestionOutcome): Promise<boolean> {
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

  return { commonQuestions, suggest, reportOutcome };
}

export type AdminHelpdeskClient = ReturnType<typeof createAdminHelpdeskClient>;
