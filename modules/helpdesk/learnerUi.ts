// Pure helpers for the learner Helpdesk pages (client-safe: type-only imports,
// no Node APIs). Business rules stay on the server; these only shape input,
// pick copy and lay out what the server returned.
import type { HelpdeskSuggestion, TicketDetail, TicketMessageView, TicketTimelineEntry } from "@/contracts/helpdesk";
import { hasControlCharacters, isBlankText, textLength } from "@/contracts/helpdeskText";

/** questionMax: the chat question limit (code points). */
export type HelpdeskUiLimits = { maxFiles: number; maxFileBytes: number; subjectMax: number; bodyMax: number; emailMax: number; questionMax: number };
export type HelpdeskUiConfig = { categories: string[]; limits: HelpdeskUiLimits; extensions: string[]; accept: string };

/**
 * The server's free-text rule (contracts/helpdesk.ts): no control characters
 * other than tab / line feed / carriage return, something visible after
 * trimming, and at most max Unicode code points (not UTF-16 units).
 */
export function isValidText(value: string, max: number): boolean {
  if (hasControlCharacters(value)) return false;
  const trimmed = value.trim();
  return !isBlankText(trimmed) && textLength(trimmed) <= max;
}

const EMAIL = /^[^\s@"<>()[\],;:\\]+@[^\s@"<>()[\],;:\\]+\.[^\s@"<>()[\],;:\\]{2,}$/;

/** The server's contact email rule (isContactEmail in contracts/helpdesk.ts), after trimming. */
export function isValidEmail(value: string, max: number): boolean {
  const trimmed = value.trim();
  return !hasControlCharacters(value) && trimmed.length <= max && EMAIL.test(trimmed);
}

/** An HTML maxLength (UTF-16 units) that never cuts off text within max code points; isValidText is the real check. */
export function inputMaxLength(max: number): number {
  return max * 2;
}

export type FileProblem = { kind: "type" | "size" | "count"; name: string };

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Client-side mirror of the server's attachment rules: allowed extension,
 * non-empty, at most maxFileBytes each, at most maxFiles in total. The server
 * re-checks the actual bytes and answers 415 / 413 when they disagree.
 */
export function screenFiles<T extends { name: string; size: number }>(currentCount: number, incoming: T[], limits: HelpdeskUiLimits, extensions: readonly string[]) {
  const accepted: T[] = [];
  const errors: FileProblem[] = [];
  for (const file of incoming) {
    if (!extensions.includes(extensionOf(file.name)) || file.size === 0) { errors.push({ kind: "type", name: file.name }); continue; }
    if (file.size > limits.maxFileBytes) { errors.push({ kind: "size", name: file.name }); continue; }
    if (currentCount + accepted.length >= limits.maxFiles) { errors.push({ kind: "count", name: file.name }); continue; }
    accepted.push(file);
  }
  return { accepted, errors };
}

export type HelpdeskErrorKey = "unauthenticated" | "notFound" | "conflict" | "tooLarge" | "unsupported" | "tooMany" | "invalid" | "reopenWindow" | "ratingWindow" | "alreadyRated" | "rateLimited" | "unavailable";

/** One learner-facing message per RFC 9457 problem (by code, falling back to the HTTP status). */
export function problemMessageKey(status: number, code: string | undefined): HelpdeskErrorKey {
  switch (code) {
    case "unauthenticated": return "unauthenticated";
    case "not_found": return "notFound";
    case "stale_ticket":
    case "invalid_transition": return "conflict";
    case "reopen_window_passed": return "reopenWindow";
    case "rating_window_passed": return "ratingWindow";
    case "already_rated": return "alreadyRated";
    case "attachment_too_large": return "tooLarge";
    case "attachment_type_unsupported": return "unsupported";
    case "too_many_attachments": return "tooMany";
    case "rate_limited": return "rateLimited";
    case "validation_failed":
    case "invalid_request":
    case "idempotency_conflict":
    case "idempotency_key_required":
    case "forbidden_origin": return "invalid";
    default: break;
  }
  if (status === 401) return "unauthenticated";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 413) return "tooLarge";
  if (status === 415) return "unsupported";
  if (status === 429) return "rateLimited";
  if (status === 400 || status === 422) return "invalid";
  return "unavailable";
}

/**
 * Idempotency-Key per logical submit: a retry of the same payload (after a
 * timeout or a 5xx) reuses the key so the server replays instead of creating
 * twice; a changed payload or a finished submit gets a fresh key.
 */
export class SubmissionKeys {
  private pending: { signature: string; key: string } | null = null;
  constructor(private readonly newKey: () => string) {}
  keyFor(signature: string): string {
    if (!this.pending || this.pending.signature !== signature) this.pending = { signature, key: this.newKey() };
    return this.pending.key;
  }
  done() {
    this.pending = null;
  }
}

/**
 * What makes two ticket submits the same logical submit (and so the same
 * Idempotency-Key): the form and the files, not which AI suggestion was
 * declined, because Admin gives every suggestion request a new id.
 */
export function submissionSignature(fields: Record<string, string>, files: { name: string; size: number; lastModified?: number }[]): string {
  const form = Object.fromEntries(Object.entries(fields).filter(([name]) => name !== "suggestionId"));
  return JSON.stringify(Object.keys(form).sort().map((name) => [name, form[name]])) + fileSignature(files);
}

/** A network failure (status 0) or a 5xx may still have created the ticket; a 4xx did not. */
function mayHaveReachedServer(status: number) {
  return status === 0 || status >= 500;
}

/**
 * Remembers a ticket submit that failed but may still have reached the
 * server. Submitting the same form again then resends that request as it
 * was (same Idempotency-Key from SubmissionKeys, same declined suggestion,
 * same chat assistIds, no new suggestion check), so a lost response replays instead of creating
 * a second ticket.
 */
export class RetryableSubmit {
  private last: { signature: string; suggestionId: string | null; assistIds: string[] } | null = null;
  failed(signature: string, suggestionId: string | null, status: number, assistIds: string[] = []) {
    this.last = mayHaveReachedServer(status) ? { signature, suggestionId, assistIds: [...assistIds] } : null;
  }
  retryFor(signature: string): { suggestionId: string | null; assistIds: string[] } | null {
    return this.last && this.last.signature === signature ? { suggestionId: this.last.suggestionId, assistIds: [...this.last.assistIds] } : null;
  }
  clear() {
    this.last = null;
  }
}

/**
 * Files to attach from a paste, or [] to let the browser paste as usual:
 * text pasted into a text field stays text (Office copies a picture of the
 * cells next to the text), and nothing is attached while the form is busy.
 * plainText is the clipboard's text/plain: only that counts as text, because
 * a text field cannot paste text/html alone (Chrome "Copy image" puts the
 * image and an <img> tag on the clipboard, and the image must still attach).
 */
export function pastedFiles<T>(paste: { files: T[]; plainText: string; intoTextField: boolean; disabled: boolean }): T[] {
  if (paste.disabled || paste.files.length === 0) return [];
  return paste.plainText.trim() !== "" && paste.intoTextField ? [] : paste.files;
}

/**
 * Focus trap for a modal: the index to move focus to on Tab, or null to let
 * the browser move it. active is the focused element's index among the
 * count focusable ones (-1: the dialog itself or something outside it).
 */
export function nextFocusIndex({ count, active, shift }: { count: number; active: number; shift: boolean }): number | null {
  if (count === 0) return -1;
  if (active < 0) return shift ? count - 1 : 0;
  if (shift && active === 0) return count - 1;
  if (!shift && active === count - 1) return 0;
  return null;
}

/** Enquiry page: after a 404 or 409 (stale, wrong state, window passed, already rated) the shown ticket is out of date, so reload it. */
export function reloadsTicket(status: number): boolean {
  return status === 404 || status === 409;
}

export function fileSignature(files: { name: string; size: number; lastModified?: number }[]): string {
  return JSON.stringify(files.map((file) => [file.name, file.size, file.lastModified ?? 0]));
}

export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return (email.trim()[0] || "?").toUpperCase();
  const letters = words.length === 1 ? [...words[0]].slice(0, 1) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return letters.join("").toUpperCase();
}

export function firstName(name: string): string | null {
  return name.trim().split(/\s+/).filter(Boolean)[0] ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export type ChatEntry =
  | { kind: "question"; text: string }
  | { kind: "answer"; id: string; reply: HelpdeskSuggestion | null; feedback: "helpful" | "not_helpful" | null }
  | { kind: "error"; error: "rateLimited" | "error" };

/** sessionStorage key of the chat transcript: per account, so a shared browser never shows one learner's chat to another. */
export function chatStorageKey(accountId: string): string {
  return `lg-helpdesk-chat:v1:${accountId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isText = (value: unknown): value is string => typeof value === "string";

function chatEntry(value: unknown): ChatEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (entry.kind === "question") return isText(entry.text) ? { kind: "question", text: entry.text } : null;
  if (entry.kind === "error") return entry.error === "rateLimited" || entry.error === "error" ? { kind: "error", error: entry.error } : null;
  if (entry.kind !== "answer" || !isText(entry.id) || !UUID.test(entry.id)) return null;
  const feedback = entry.feedback === "helpful" || entry.feedback === "not_helpful" ? entry.feedback : entry.feedback === null ? null : undefined;
  if (feedback === undefined) return null;
  if (entry.reply === null) return { kind: "answer", id: entry.id, reply: null, feedback };
  const reply = entry.reply as Record<string, unknown> | undefined;
  if (!reply || !isText(reply.id) || !isText(reply.faqId) || !isText(reply.question) || !isText(reply.answer)) return null;
  return { kind: "answer", id: entry.id, reply: { id: reply.id, faqId: reply.faqId, question: reply.question, answer: reply.answer }, feedback };
}

/** The stored transcript, keeping only well-formed entries (storage is the browser's, not ours). */
export function readTranscript(raw: string | null): ChatEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  return Array.isArray(parsed) ? parsed.map(chatEntry).filter((entry): entry is ChatEntry => entry !== null) : [];
}

/** A transcript read back after a reload: a question whose answer never arrived (the tab went away mid-request) gets the error bubble, so the learner can ask again. */
export function settleTranscript(entries: ChatEntry[]): ChatEntry[] {
  return entries.length && entries[entries.length - 1].kind === "question" ? [...entries, { kind: "error", error: "error" }] : entries;
}

/** The chat answers to link to the enquiry: the newest max, once each (the server accepts at most 10 assistIds). */
export function assistIdsOf(entries: ChatEntry[], max = 10): string[] {
  const ids: string[] = [];
  for (const entry of [...entries].reverse()) if (entry.kind === "answer" && !ids.includes(entry.id)) ids.push(entry.id);
  return ids.slice(0, max).reverse();
}

export type TextSegment = { text: string; href?: string };

/** http(s) URLs become links (trailing punctuation stays text); nothing else is interpreted. */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const url = match[0].replace(/[.,;:!?)\]]+$/, "");
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 365 * 86400], ["month", 30 * 86400], ["day", 86400], ["hour", 3600], ["minute", 60]];

export function relativeTime(iso: string, nowMs: number, locale: string): string {
  const seconds = Math.round((Date.parse(iso) - nowMs) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(seconds, "second");
}

/** State changes worth a line in the learner's conversation (message events are the messages themselves). */
const SHOWN_EVENTS = new Set(["claimed", "resolution_proposed", "resolution_rejected", "confirmed", "auto_confirmed", "closed_by_learner", "cancelled", "reopened", "rated"]);

export type ConversationItem = { kind: "message"; at: string; message: TicketMessageView } | { kind: "event"; at: string; event: TicketTimelineEntry };

export function conversationItems(ticket: Pick<TicketDetail, "messages" | "timeline">): ConversationItem[] {
  const items: ConversationItem[] = [
    ...ticket.messages.map((message) => ({ kind: "message" as const, at: message.createdAt, message })),
    ...ticket.timeline.filter((event) => SHOWN_EVENTS.has(event.type)).map((event) => ({ kind: "event" as const, at: event.time, event }))
  ];
  // Stable: messages before a state line stamped in the same millisecond (a reply that also changes state).
  return items.map((item, index) => ({ item, index })).sort((a, b) => Date.parse(a.item.at) - Date.parse(b.item.at) || a.index - b.index).map(({ item }) => item);
}
