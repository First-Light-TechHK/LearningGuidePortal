// Browser calls to the learner Helpdesk endpoints (docs/phase1/helpdesk-tickets.md).
// Success bodies are plain JSON; failures are RFC 9457 problems, reduced here
// to { status, code } so the page can pick one message. A network failure is
// status 0. Nothing here decides business rules.
import type { HelpdeskSuggestion, SuggestionOutcome, TicketDetail } from "@/contracts/helpdesk";

export type ApiFailure = { ok: false; status: number; code?: string };
export type ApiResult<T> = { ok: true; status: number; data: T } | ApiFailure;

async function call<T>(input: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(input, { cache: "no-store", credentials: "same-origin", ...init });
    const text = response.status === 204 ? "" : await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (response.ok) return { ok: true, status: response.status, data: body as T };
    const code = body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : undefined;
    return { ok: false, status: response.status, code };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** The AI suggestion must never block submitting: any failure or a slow answer counts as "no suggestion". */
export async function requestSuggestion(input: { category: string; subject: string; message: string; locale: string }, timeoutMs = 5_000): Promise<HelpdeskSuggestion | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await call<{ suggestion: HelpdeskSuggestion | null }>("/api/helpdesk/suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
    return result.ok && result.data?.suggestion ? result.data.suggestion : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fire and forget: Admin counts the outcome; the learner's next step never waits on it. */
export function reportSuggestionOutcome(suggestionId: string, outcome: SuggestionOutcome): void {
  void call(`/api/helpdesk/suggestions/${encodeURIComponent(suggestionId)}/outcome`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome }), keepalive: true });
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
