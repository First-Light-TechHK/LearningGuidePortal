// Browser calls to the learner Helpdesk endpoints (docs/phase1/helpdesk-tickets.md).
// Success bodies are plain JSON; failures are RFC 9457 problems, reduced here
// to { status, code } so the page can pick one message. A network failure is
// status 0. Nothing here decides business rules.
import { createEventStreamParser, isAssistantStep, type AssistantStep } from "@/contracts/helpdeskStream";
import type { AssistantFeedbackResponse, AssistantRatingResponse, AssistantResponse, AssistantSessionResponse, ClickVia, HelpdeskAlternative, LearnerEndReason, SuggestionOutcome, SuggestionResponse, TicketDetail } from "@/contracts/helpdesk";

/** field (v4, additive): the problem's field, when the server names one (for example orderId). */
export type ApiFailure = { ok: false; status: number; code?: string; field?: string };
export type ApiResult<T> = { ok: true; status: number; data: T } | ApiFailure;

async function call<T>(input: string, init: RequestInit = {}, onStep?: (step: AssistantStep) => void): Promise<ApiResult<T>> {
  try {
    const response = await fetch(input, { cache: "no-store", credentials: "same-origin", ...init });
    if (onStep && response.ok && response.body && (response.headers.get("content-type") ?? "").includes("text/event-stream")) return await streamed<T>(response.body, onStep);
    const text = response.status === 204 ? "" : await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return resultOf<T>(response.ok, response.status, body);
  } catch {
    return { ok: false, status: 0 };
  }
}

function resultOf<T>(ok: boolean, status: number, body: unknown): ApiResult<T> {
  if (ok) return { ok: true, status, data: body as T };
  const code = body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : undefined;
  const field = body && typeof body === "object" && typeof (body as { field?: unknown }).field === "string" ? (body as { field: string }).field : undefined;
  return { ok: false, status, code, ...(field ? { field } : {}) };
}

/** v7: a streamed answer: steps go to onStep; result is the body, error the problem (its status inside); a cut stream is status 0. */
async function streamed<T>(body: ReadableStream<Uint8Array>, onStep: (step: AssistantStep) => void): Promise<ApiResult<T>> {
  const parser = createEventStreamParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  const parse = (data: string): unknown => { try { return JSON.parse(data); } catch { return null; } };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      for (const event of parser.push(done ? `${decoder.decode()}\n\n` : decoder.decode(value, { stream: true }))) {
        if (event.event === "step") {
          const step = (parse(event.data) as { step?: unknown } | null)?.step;
          if (isAssistantStep(step)) onStep(step);
        } else if (event.event === "result") {
          return { ok: true, status: 200, data: parse(event.data) as T };
        } else if (event.event === "error") {
          const problem = parse(event.data);
          const status = Number((problem as { status?: unknown } | null)?.status);
          return resultOf<T>(false, Number.isInteger(status) && status >= 400 ? status : 500, problem);
        }
      }
      if (done) return { ok: false, status: 0 };
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** Up to 3 well-formed alternatives from a body the server sent (an older server sends none). */
export function alternativesIn(value: unknown): HelpdeskAlternative[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HelpdeskAlternative => Boolean(item) && typeof item === "object" && typeof (item as HelpdeskAlternative).faqId === "string" && typeof (item as HelpdeskAlternative).question === "string" && (item as HelpdeskAlternative).question !== "").slice(0, 3);
}

/**
 * The AI suggestion must never block submitting: any failure or a slow answer
 * counts as "no suggestion" and no alternatives (v3), so the page submits.
 */
export async function requestSuggestion(input: { category: string; subject: string; message: string; locale: string }, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<SuggestionResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  // The page aborts when the learner cancels or leaves.
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const result = await call<Partial<SuggestionResponse>>("/api/helpdesk/suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
    if (!result.ok || !result.data) return { suggestion: null, alternatives: [] };
    if (result.data.suggestion) return { suggestion: result.data.suggestion, alternatives: [] };
    return { suggestion: null, alternatives: alternativesIn(result.data.alternatives) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire and forget: Admin counts the outcome; the learner's next step never waits on it. */
export function reportSuggestionOutcome(suggestionId: string, outcome: SuggestionOutcome): void {
  void call(`/api/helpdesk/suggestions/${encodeURIComponent(suggestionId)}/outcome`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome }), keepalive: true });
}

/** The server answers within about 4 s (its Admin timeout); a request still open after this is given up as a network failure. */
export const ASSISTANT_TIMEOUT_MS = 15_000;

/**
 * One chat question or starter chip (faqId). The reply is Admin's FAQ answer verbatim, or null (show the fallback).
 * v5: sessionId (the chat session) and via (a chip's reason, only with faqId) are sent when the chat has a session;
 * the response then carries the server's turn (read with storedTurn).
 */
export async function askAssistant(body: { message: string; locale: string; faqId?: string; sessionId?: string; via?: ClickVia }, idempotencyKey: string, onStep?: (step: AssistantStep) => void) {
  return post<AssistantResponse & { turn?: unknown }>("/api/helpdesk/assistant", body, idempotencyKey, onStep);
}

/** onStep (v7): ask for the streamed answer; the steps of the server's workflow arrive while it works. */
async function post<T>(path: string, body: unknown, idempotencyKey: string, onStep?: (step: AssistantStep) => void) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
    if (onStep) headers.Accept = "text/event-stream, application/json";
    return await call<T>(path, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal }, onStep);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * v5 (graph design §4): a chip, follow-up or A/B/C/D option of Admin's published release. The server checks the click
 * against its cached release (fromNodeId: the card it was clicked on) and shows the node verbatim; no model is asked.
 */
export function clickAssistant(body: { locale: string; nodeId: string; fromNodeId: string | null; via: ClickVia; sessionId: string | null; label: string }, idempotencyKey: string) {
  return post<AssistantResponse & { turn?: unknown }>("/api/helpdesk/assistant/click", body, idempotencyKey);
}

/** v5 Part A: a new chat session and its situation chips (after an end; the page starts the first one). */
export function startAssistantSession(body: { locale: string; orderId?: string }) {
  return call<AssistantSessionResponse>("/api/helpdesk/assistant/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** v5: fire and forget; the server keeps the first end of a session. */
export function endAssistantSession(sessionId: string, reason: LearnerEndReason): void {
  void call(`/api/helpdesk/assistant/sessions/${encodeURIComponent(sessionId)}/end`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }), keepalive: true });
}

/** v5 Part H: fire and forget; the learner opened the full answer under an excerpt (logged once by the server). */
export function reportExpanded(assistId: string): void {
  void call(`/api/helpdesk/assistant/${encodeURIComponent(assistId)}/expanded`, { method: "POST", keepalive: true });
}

/** "Helpful?" Yes / No on a chat answer; the server keeps the first value and returns it. */
export function sendAssistantFeedback(id: string, helpful: boolean, idempotencyKey: string) {
  return call<AssistantFeedbackResponse>(`/api/helpdesk/assistant/${encodeURIComponent(id)}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ helpful }) });
}

/** A rating save still open after this is given up as a network failure, so the card offers retry or Skip instead of waiting. */
export const RATING_TIMEOUT_MS = 5_000;

/** v3 §2 rating card: 1-5 stars for an answer the learner was shown; the server keeps the first (409 answer_already_rated for another value). */
export async function rateAnswer(id: string, rating: number, idempotencyKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATING_TIMEOUT_MS);
  try {
    return await call<AssistantRatingResponse>(`/api/helpdesk/assistant/${encodeURIComponent(id)}/rating`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ rating }), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createTicket(form: FormData, idempotencyKey: string) {
  return call<TicketDetail>("/api/helpdesk/tickets", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: form });
}

export function loadTicket(id: string) {
  return call<TicketDetail>(`/api/helpdesk/tickets/${encodeURIComponent(id)}`);
}

export function sendTicketMessage(id: string, form: FormData, idempotencyKey: string) {
  return call<TicketDetail>(`/api/helpdesk/tickets/${encodeURIComponent(id)}/messages`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: form });
}

export function sendTicketAction(id: string, body: { action: string; expectedSequence: number; rating?: number; message?: string }, idempotencyKey: string) {
  return call<TicketDetail>(`/api/helpdesk/tickets/${encodeURIComponent(id)}/actions`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
}

/** A UUID for Idempotency-Key (crypto.randomUUID needs a secure context; fall back to getRandomValues). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
