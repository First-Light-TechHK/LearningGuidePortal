// Pure helpers for the learner Helpdesk pages (client-safe: type-only imports,
// no Node APIs). Business rules stay on the server; these only shape input,
// pick copy and lay out what the server returned.
import type { TicketDetail, TicketMessageView, TicketTimelineEntry } from "@/contracts/helpdesk";

export type HelpdeskUiLimits = { maxFiles: number; maxFileBytes: number; subjectMax: number; bodyMax: number; emailMax: number };
export type HelpdeskUiConfig = { categories: string[]; limits: HelpdeskUiLimits; extensions: string[]; accept: string };

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

export type HelpdeskErrorKey = "unauthenticated" | "notFound" | "conflict" | "tooLarge" | "unsupported" | "tooMany" | "invalid" | "reopenWindow" | "ratingWindow" | "alreadyRated" | "unavailable";

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

export type AnswerBlock = { heading: string | null; lines: string[] };

/**
 * Lays out an approved Q&A answer without changing a word: paragraphs split on
 * blank lines, and a paragraph whose first line is numbered ("1. …") and has
 * more lines shows that first line as a heading (Figma 1333:249).
 */
export function answerBlocks(answer: string): AnswerBlock[] {
  return answer.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((block) => block.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim() !== "")).filter((lines) => lines.length > 0).map((lines) => (
    lines.length > 1 && /^\d+[.)]\s/.test(lines[0]) ? { heading: lines[0], lines: lines.slice(1) } : { heading: null, lines }
  ));
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
