// Pure helpers for the learner Helpdesk pages (client-safe: type-only imports,
// no Node APIs). Business rules stay on the server; these only shape input,
// pick copy and lay out what the server returned.
import type { AssistantTurn, HelpdeskAlternative, HelpdeskSuggestion, TicketDetail, TicketMessageView, TicketTimelineEntry } from "@/contracts/helpdesk";
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

/**
 * One line of the chat transcript. v4 Part B (helpdesk-v4-order-and-chat-end):
 * questions and answers carry the time they were shown (at, ISO; left out by
 * older transcripts) for the idle end, and three code-decided cards join them:
 * the handover card ("requested": the learner asked for a person; "unsolved":
 * two unsolved turns in a row), the "Still need help?" check-in, and the end
 * of a session ("idle" or the learner's End chat) with the rating card state
 * of the assist it rates (ratingFor; null: nothing was answered).
 * v5: an answer carries the server's turn (smalltalk, clarify, the excerpt and
 * next steps), so the v4 rules can tell small talk and clarify turns apart.
 */
export type ChatEntry =
  | { kind: "question"; text: string; at?: string }
  | { kind: "answer"; id: string; reply: HelpdeskSuggestion | null; feedback: "helpful" | "not_helpful" | null; /** v3: "You might be asking" chips under a fallback (left out when none). */ alternatives?: HelpdeskAlternative[]; at?: string; /** v5: the server's turn (kind, guarded strings, excerpt, next steps); left out by older transcripts and an older server. */ turn?: AssistantTurn }
  | { kind: "error"; error: "rateLimited" | "error" }
  | { kind: "handover"; reason: "requested" | "unsolved" }
  | { kind: "checkin" }
  | { kind: "ended"; reason: "idle" | "learner"; ratingFor: string | null; rating: "open" | "rated" | "skipped" }
  /** v5 Part B §3: the v3 rating card after "thanks" / "bye" that followed an answered assist (the session goes on). */
  | { kind: "rate"; ratingFor: string; rating: "open" | "rated" | "skipped" };

/** sessionStorage key of the chat transcript: per account, so a shared browser never shows one learner's chat to another. */
export function chatStorageKey(accountId: string): string {
  return `lg-helpdesk-chat:v1:${accountId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isText = (value: unknown): value is string => typeof value === "string";

function storedAlternatives(value: unknown): HelpdeskAlternative[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return isText(entry.faqId) && UUID.test(entry.faqId) && isText(entry.question) && entry.question ? [{ faqId: entry.faqId, question: entry.question }] : [];
  });
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** v4: { at } when the stored time is a well-formed ISO time, otherwise nothing (older transcripts have none). */
const storedAt = (value: unknown): { at?: string } => (isText(value) && ISO_TIME.test(value) && Number.isFinite(Date.parse(value)) ? { at: value } : {});

function chatEntry(value: unknown): ChatEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (entry.kind === "question") return isText(entry.text) ? { kind: "question", text: entry.text, ...storedAt(entry.at) } : null;
  if (entry.kind === "error") return entry.error === "rateLimited" || entry.error === "error" ? { kind: "error", error: entry.error } : null;
  if (entry.kind === "handover") return entry.reason === "requested" || entry.reason === "unsolved" ? { kind: "handover", reason: entry.reason } : null;
  if (entry.kind === "checkin") return { kind: "checkin" };
  if (entry.kind === "ended") {
    const reason = entry.reason === "idle" || entry.reason === "learner" ? entry.reason : null;
    const rating = entry.rating === "open" || entry.rating === "rated" || entry.rating === "skipped" ? entry.rating : null;
    const ratingFor = entry.ratingFor === null ? null : isText(entry.ratingFor) && UUID.test(entry.ratingFor) ? entry.ratingFor : undefined;
    return reason && rating && ratingFor !== undefined ? { kind: "ended", reason, ratingFor, rating } : null;
  }
  if (entry.kind === "rate") {
    const rating = entry.rating === "open" || entry.rating === "rated" || entry.rating === "skipped" ? entry.rating : null;
    return rating && isText(entry.ratingFor) && UUID.test(entry.ratingFor) ? { kind: "rate", ratingFor: entry.ratingFor, rating } : null;
  }
  if (entry.kind !== "answer" || !isText(entry.id) || !UUID.test(entry.id)) return null;
  const feedback = entry.feedback === "helpful" || entry.feedback === "not_helpful" ? entry.feedback : entry.feedback === null ? null : undefined;
  if (feedback === undefined) return null;
  const at = storedAt(entry.at);
  const turn = storedTurn(entry.turn);
  const withTurn = turn ? { turn } : {};
  if (entry.reply === null) {
    const alternatives = storedAlternatives(entry.alternatives);
    return alternatives.length ? { kind: "answer", id: entry.id, reply: null, feedback, alternatives, ...at, ...withTurn } : { kind: "answer", id: entry.id, reply: null, feedback, ...at, ...withTurn };
  }
  const reply = entry.reply as Record<string, unknown> | undefined;
  if (!reply || !isText(reply.id) || !isText(reply.faqId) || !isText(reply.question) || !isText(reply.answer)) return null;
  return { kind: "answer", id: entry.id, reply: { id: reply.id, faqId: reply.faqId, question: reply.question, answer: reply.answer }, feedback, ...at, ...withTurn };
}

const TURN_KINDS = ["answer", "smalltalk", "clarify", "no_match"] as const;
const TURN_INTENTS = ["question", "own_account", "someone_else", "exception", "private_data", "instructions", "off_topic", "greeting", "farewell", "vague", "clarify"] as const;
const TURN_VIAS = ["typed", "follow_up", "option", "starter", "signal", "alternative"] as const;
const BLOCK_ID = /^b[1-9]\d{0,3}$/;
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null => ((values as readonly unknown[]).includes(value) ? value as T : null);
const textOrNull = (value: unknown): string | null => (isText(value) && value !== "" ? value : null);

/**
 * v5: the stored turn of an answer (the browser's storage, so read tolerantly). A turn without a known kind, via,
 * session or turn index is dropped (the entry then reads as before v5); malformed parts read as absent.
 */
export function storedTurn(value: unknown): AssistantTurn | null {
  if (!value || typeof value !== "object") return null;
  const turn = value as Record<string, unknown>;
  const kind = oneOf(TURN_KINDS, turn.kind);
  const via = oneOf(TURN_VIAS, turn.via);
  if (!kind || !via || !isText(turn.sessionId) || !UUID.test(turn.sessionId) || typeof turn.turnIndex !== "number" || !Number.isInteger(turn.turnIndex) || turn.turnIndex < 1) return null;
  const id = (raw: unknown) => (isText(raw) && UUID.test(raw) ? raw : null);
  const excerpt = Array.isArray(turn.excerpt)
    ? turn.excerpt.flatMap((item: unknown) => {
      const block = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return isText(block.id) && BLOCK_ID.test(block.id) && isText(block.text) && block.text ? [{ id: block.id, text: block.text }] : [];
    })
    : [];
  const rawNext = turn.next && typeof turn.next === "object" ? turn.next as Record<string, unknown> : null;
  const nextKind = rawNext ? oneOf(["follow_up", "option"] as const, rawNext.kind) : null;
  const steps = rawNext && Array.isArray(rawNext.steps)
    ? rawNext.steps.flatMap((item: unknown) => {
      const step = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const nodeId = id(step.nodeId);
      return nodeId && isText(step.label) && step.label ? [{ nodeId, label: step.label }] : [];
    })
    : [];
  const rawSource = turn.source && typeof turn.source === "object" ? turn.source as Record<string, unknown> : null;
  const sourceId = rawSource ? id(rawSource.faqId) : null;
  return {
    kind, intent: oneOf(TURN_INTENTS, turn.intent), via, nodeId: id(turn.nodeId), nodeType: oneOf(["answer", "choice"] as const, turn.nodeType),
    opening: textOrNull(turn.opening), closing: textOrNull(turn.closing), reply: textOrNull(turn.reply), explanation: textOrNull(turn.explanation),
    covered: typeof turn.covered === "boolean" ? turn.covered : null,
    excerpt: excerpt.length ? excerpt : null,
    next: nextKind && steps.length ? { kind: nextKind, steps } : null,
    source: sourceId && rawSource && isText(rawSource.question) && rawSource.question ? { faqId: sourceId, question: rawSource.question } : null,
    releaseVersion: typeof turn.releaseVersion === "number" && Number.isInteger(turn.releaseVersion) && turn.releaseVersion >= 1 ? turn.releaseVersion : null,
    sessionId: turn.sessionId, turnIndex: turn.turnIndex,
    unsolved: turn.unsolved === true, countsAsQuestion: turn.countsAsQuestion !== false
  };
}

/** v5 (graph design §1): the letter of a choice card's option, A to D. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
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

/**
 * v3: what a ticket from the submit modal links — the chat answers and the
 * answers of the alternatives the learner picked there — the newest max, once
 * each (the server accepts at most 10 assistIds).
 */
export function linkedAssistIds(chatIds: string[], pickedIds: string[], max = 10): string[] {
  const ids: string[] = [];
  for (const id of [...chatIds, ...pickedIds].reverse()) if (!ids.includes(id)) ids.push(id);
  return ids.slice(0, max).reverse();
}

/**
 * v3: the submit modal's answers the learner was shown (the suggestion, a
 * picked alternative's answer), kept for this tab per account like the chat
 * transcript, so the next enquiry links them even after Edit, Close or a
 * "Yes, solved" that went back to the account (the agent then sees what the
 * learner was already told, with its feedback and rating). Only inside the
 * server's link window (HELPDESK_LIMITS.assistLinkWindowHours): older answers
 * would not be linked anyway.
 */
export const SEEN_ANSWER_WINDOW_MS = 24 * 3_600_000;
const SEEN_ANSWERS_MAX = 10;
export type SeenAnswer = { id: string; at: string };

export function seenStorageKey(accountId: string): string {
  return `lg-helpdesk-seen:v1:${accountId}`;
}

/** The stored list, keeping well-formed entries inside the window (storage is the browser's), once each, newest 10. */
export function readSeenAnswers(raw: string | null, now: Date): SeenAnswer[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const since = now.getTime() - SEEN_ANSWER_WINDOW_MS;
  let found: SeenAnswer[] = [];
  for (const value of parsed) {
    const entry = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (!isText(entry.id) || !UUID.test(entry.id) || !isText(entry.at)) continue;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || at <= since || at > now.getTime()) continue;
    const id = entry.id.toLowerCase();
    found = [...found.filter((item) => item.id !== id), { id, at: new Date(at).toISOString() }];
  }
  return found.slice(-SEEN_ANSWERS_MAX);
}

/** Adds (or moves to the end) one answer id the learner was shown; the newest 10 are kept. */
export function rememberSeenAnswer(list: SeenAnswer[], id: string, now: Date): SeenAnswer[] {
  if (!UUID.test(id)) return list;
  const key = id.toLowerCase();
  return [...list.filter((item) => item.id !== key), { id: key, at: now.toISOString() }].slice(-SEEN_ANSWERS_MAX);
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
