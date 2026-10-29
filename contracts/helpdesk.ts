// Helpdesk Tickets v1 — API contract (docs/phase1/helpdesk-tickets.md, with
// the 2026-10-28 Figma addendum: enquiry types, contact email, AI suggestion,
// wider attachments, tags, unread flag and the BackOffice projections).
// Types, limits, input parsing and RFC 9457 problem codes for the learner
// endpoints (/api/helpdesk/**) and the Admin → Portal integration endpoints
// (/api/integration/helpdesk/**). Success bodies are plain JSON; errors are
// application/problem+json. Nothing here touches storage.
import { isUuid } from "@/lib/uuidv7";
import { hasControlCharacters, isBlankText, textLength } from "./helpdeskText";

export const HELPDESK_LIMITS = {
  subjectMax: 120,
  bodyMax: 5000,
  filesPerMessage: 5,
  fileMaxBytes: 10 * 1024 * 1024,
  fileNameMax: 120,
  contactEmailMax: 254,
  tagMax: 32,
  tagsPerTicket: 10,
  previewMax: 120,
  agentIdMax: 128,
  agentNameMax: 120,
  queryMax: 120,
  listLimitDefault: 20,
  listLimitMax: 100,
  /** Per learner, rolling hour, counted from helpdesk_tickets. */
  ticketsPerHour: 10,
  /** Per learner, rolling hour, counted from helpdesk_ticket_messages (every learner message, a ticket's first one included). */
  learnerMessagesPerHour: 60,
  /** v2 §4b: assistant questions (chat + chip) per learner, rolling hour, counted from helpdesk_assist_log. */
  assistantPerHour: 30,
  /** v2 §2/§4b: submit-time suggestion checks per learner, rolling hour, counted from helpdesk_assist_log (Admin's own limit is the same 10). */
  submitChecksPerHour: 10,
  /** v2 §4a: what the learner typed (or the chip question) as stored in helpdesk_assist_log. */
  assistQuestionMax: 500,
  /** v2 §4a: assistant answers a new ticket may link. */
  assistIdsPerTicket: 10,
  /** v2 §4a: only answers younger than this are linked to a new ticket. */
  assistLinkWindowHours: 24,
  learnerIdMax: 128
} as const;

export const TICKET_STATUSES = ["OPEN", "ASSIGNED", "WAITING_USER", "PENDING_CONFIRM", "CLOSED", "CANCELLED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
/** Figma 1216:6 "Enquiry Type": Technical Support, Course Content, Payments & Subscriptions, Other Enquiries. */
export const TICKET_CATEGORIES = ["technical_support", "course_content", "payments_subscriptions", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const HELPDESK_LOCALES = ["en-GB", "zh-CN"] as const;
export type HelpdeskLocale = (typeof HELPDESK_LOCALES)[number];
/** Detected from content (magic bytes / ZIP structure / clean UTF-8 text), never from the declared type. No html, no svg. */
export const HELPDESK_ATTACHMENT_TYPES = [
  "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
] as const;
export type HelpdeskAttachmentType = (typeof HELPDESK_ATTACHMENT_TYPES)[number];
export type AuthorKind = "learner" | "agent" | "system";
export type CloseReason = "cancelled" | "user_confirmed" | "user_closed" | "auto_confirmed";

export const LEARNER_ACTIONS = ["cancel", "confirm", "reject", "close", "rate"] as const;
export type LearnerAction = (typeof LEARNER_ACTIONS)[number];
/** v2 §4a adds flag / unflag ("Flag follow-up" in the BackOffice action bar). */
export const AGENT_ACTIONS = ["claim", "propose_resolution", "add_tag", "remove_tag", "mark_read", "flag", "unflag"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];
/** What the learner may do now ("reply" = send a message / follow up). */
export type LearnerAllowedAction = "reply" | LearnerAction;
/** What an agent may do now. */
export type AgentAllowedAction = "claim" | "reply" | "internal_note" | "propose_resolution";

/** Status labels from spec §2 (UI copy lives in messages/*.json; this table is for server-side text such as notifications). */
export const STATUS_LABELS: Record<"learner" | "agent", Record<HelpdeskLocale, Record<TicketStatus, string>>> = {
  learner: {
    "en-GB": { OPEN: "Submitted", ASSIGNED: "In progress", WAITING_USER: "Awaiting your reply", PENDING_CONFIRM: "Awaiting your confirmation", CLOSED: "Completed", CANCELLED: "Withdrawn" },
    "zh-CN": { OPEN: "已提交", ASSIGNED: "处理中", WAITING_USER: "待你回复", PENDING_CONFIRM: "待你确认", CLOSED: "已完成", CANCELLED: "已撤回" }
  },
  agent: {
    "en-GB": { OPEN: "New", ASSIGNED: "In progress", WAITING_USER: "Waiting for learner", PENDING_CONFIRM: "Awaiting confirmation", CLOSED: "Closed", CANCELLED: "Withdrawn" },
    "zh-CN": { OPEN: "待受理", ASSIGNED: "处理中", WAITING_USER: "等待用户", PENDING_CONFIRM: "待用户确认", CLOSED: "已结束", CANCELLED: "已撤回" }
  }
};

// ---------------------------------------------------------------- responses

export type AttachmentView = { id: string; fileName: string; contentType: HelpdeskAttachmentType; sizeBytes: number; url: string };

export type TicketSummary = {
  id: string;
  number: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessageBy: AuthorKind;
  confirmDueAt: string | null;
  closedAt: string | null;
  sequence: number;
};

export type TicketMessageView = {
  id: string;
  authorKind: AuthorKind;
  authorName: string | null;
  body: string;
  createdAt: string;
  attachments: AttachmentView[];
};

/** Learner-safe state-change line (never internal notes, never agent ids). */
export type TicketTimelineEntry = {
  id: string;
  type: HelpdeskEventName;
  time: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  actor: { kind: AuthorKind; name: string | null };
};

export type TicketDetail = TicketSummary & {
  locale: HelpdeskLocale;
  /** Where replies are emailed (defaults to the account email). */
  contactEmail: string;
  assigneeName: string | null;
  closeReason: CloseReason | null;
  rating: number | null;
  /** End of the 7-day follow-up / rating window while CLOSED and still open; otherwise null. */
  followUpUntil: string | null;
  messages: TicketMessageView[];
  timeline: TicketTimelineEntry[];
  allowedActions: LearnerAllowedAction[];
};

export type HelpdeskEventName =
  | "created" | "claimed" | "agent_replied" | "internal_note_added" | "learner_replied" | "resolution_proposed"
  | "resolution_rejected" | "confirmed" | "auto_confirmed" | "closed_by_learner" | "cancelled" | "reopened" | "rated"
  | "suggestion_declined" | "tag_added" | "tag_removed" | "flagged" | "unflagged";

export type HelpdeskEventData = {
  from_state: TicketStatus | null;
  to_state: TicketStatus;
  actor: { kind: AuthorKind; id: string | null; name: string | null };
  reason?: string;
  message_id?: string;
  rating?: number;
  suggestion_id?: string;
  tag?: string;
};

/** CloudEvents 1.0 (structured JSON field names) plus the per-ticket sequence. */
export type HelpdeskCloudEvent = {
  id: string;
  specversion: "1.0";
  source: "/portal/helpdesk";
  type: string;
  subject: string;
  time: string;
  datacontenttype: "application/json";
  data: HelpdeskEventData;
  sequence: number;
};

export type AgentIdentity = { id: string; name: string };

export type AgentTicketSummary = TicketSummary & {
  locale: HelpdeskLocale;
  learner: { id: string; email: string; name: string };
  assignee: AgentIdentity | null;
  needsReply: boolean;
  contactEmail: string;
  /** First 120 characters of the learner's first message, on one line. */
  preview: string;
  /** A learner created the ticket or wrote since an agent last opened it (mark_read). */
  unreadByAgent: boolean;
  tags: string[];
  /** v2 §4a: an agent flagged the enquiry for follow-up. */
  flagged: boolean;
};

/** BackOffice "Student Information" (read-only projection of existing Portal data). */
export type StudentProjection = {
  /** Portal user id (shown as Student ID). */
  id: string;
  name: string;
  accountEmail: string;
  contactEmail: string;
  joinedAt: string | null;
  totalEnquiries: number;
  currentCourse: { id: string; title: string } | null;
};

/** Subscription states the BackOffice may receive (the live ones); Admin labels each of them. */
export const SUBSCRIPTION_STATUSES = ["active", "cancel_at_period_end", "grace"] as const;
/** Billing cycles the BackOffice may receive; Admin labels each of them. */
export const BILLING_CYCLES = ["annual", "semiannual"] as const;

/** BackOffice "Current Subscription Plan" (read-only; the order/payment owner owns the data). */
export type SubscriptionProjection = {
  planName: string;
  /** From the plan term: 12 months = annual, 6 months = semiannual; null when the plan is gone. */
  billingCycle: (typeof BILLING_CYCLES)[number] | null;
  status: (typeof SUBSCRIPTION_STATUSES)[number];
  trial: boolean;
  /** Next renewal; null when the plan will not renew (cancelling, or grace). */
  renewalDate: string | null;
  validTo: string;
};

export type AgentTicketMessageView = TicketMessageView & { authorId: string | null; internal: boolean };

export type AgentTicketDetail = Omit<AgentTicketSummary, "learner"> & {
  learner: { id: string; email: string; name: string; locale: HelpdeskLocale };
  suggestionId: string | null;
  student: StudentProjection;
  subscription: SubscriptionProjection | null;
  closeReason: CloseReason | null;
  rating: number | null;
  followUpUntil: string | null;
  messages: AgentTicketMessageView[];
  events: HelpdeskCloudEvent[];
  allowedActions: AgentAllowedAction[];
  /** v2 §4a: the AI Support Assistant answers linked to this enquiry, oldest first (as stored by Portal; never client text). */
  aiAssist: AiAssistView[];
};

export type TicketCounts = Record<TicketStatus, number> & { needs_reply: number; all: number };
export type LearnerTicketList = { tickets: TicketSummary[] };
export type AgentTicketList = { tickets: AgentTicketSummary[]; nextCursor: string | null; counts: TicketCounts };

// ---------------------------------------------------------------- Admin-owned FAQs and the AI Support Assistant (v2 §1, §2, §4)

/** v2 §1: Help Centre topics (Admin owns the FAQs; Portal only reads published ones). */
export const FAQ_CATEGORIES = ["account_technical", "courses_learning", "payments_subscriptions", "other"] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];
/** A published FAQ in one locale; answer is the Markdown subset (modules/helpdesk/markdown.ts). */
export type HelpFaq = { id: string; category: FaqCategory; popular: boolean; question: string; answer: string; updatedAt: string };
export type FaqFilter = { popular?: boolean; category?: FaqCategory | null; q?: string; limit?: number };
/** One stored answer, shown verbatim. */
export type HelpdeskSuggestion = { id: string; faqId: string; question: string; answer: string };
export type SuggestionResponse = { suggestion: HelpdeskSuggestion | null };
/** Where an assistant answer was shown: the submit-time modal, the chat panel, or a starter chip. */
export const ASSIST_SOURCES = ["submit", "chat", "chip"] as const;
export type AssistSource = (typeof ASSIST_SOURCES)[number];
/** What the learner did with the submit-time suggestion (1333:249). */
export const SUGGESTION_OUTCOMES = ["solved", "declined", "edited"] as const;
export type SuggestionOutcome = (typeof SUGGESTION_OUTCOMES)[number];
/** Every outcome Admin records: the submit modal's three plus the chat's Helpful? Yes / No. First one wins. */
export const ASSIST_FEEDBACK = ["helpful", "not_helpful", "solved", "declined", "edited"] as const;
export type AssistFeedback = (typeof ASSIST_FEEDBACK)[number];
export type SuggestInput = { category: TicketCategory; subject: string; message: string; locale: HelpdeskLocale };
/** Portal -> Admin POST /api/integration/helpdesk/suggest (v2 §2). */
export type AdminSuggestRequest = { learnerId: string; locale: HelpdeskLocale; source: AssistSource; category?: TicketCategory; subject?: string; message: string; faqId?: string };
/** POST /api/helpdesk/assistant body (v2 §4b). */
export type AssistantInput = { message: string; locale: HelpdeskLocale; faqId: string | null };
/** id is the assist log row (link it with assistIds); reply null = show the fallback copy. */
export type AssistantResponse = { id: string; reply: HelpdeskSuggestion | null };
export type AssistantFeedbackResponse = { id: string; feedback: AssistFeedback | null };
/** BackOffice AI block (v2 §3d / §4a). */
export type AiAssistView = { id: string; source: AssistSource; question: string; faqId: string | null; faqQuestion: string | null; answer: string | null; feedback: AssistFeedback | null; createdAt: string };

// ---------------------------------------------------------------- problems

export const PROBLEM_TYPE_BASE = "https://www.ilovelearningguide.com/problems/";

export const PROBLEM_STATUS = {
  invalid_request: 400,
  validation_failed: 400,
  too_many_attachments: 400,
  attachment_too_large: 413,
  attachment_type_unsupported: 415,
  idempotency_key_required: 400,
  unauthenticated: 401,
  invalid_token: 401,
  forbidden_origin: 403,
  not_found: 404,
  // draft-ietf-httpapi-idempotency-key-header: a key reused with a different payload is 422.
  idempotency_conflict: 422,
  stale_ticket: 409,
  invalid_transition: 409,
  reopen_window_passed: 409,
  rating_window_passed: 409,
  already_rated: 409,
  tag_limit_reached: 409,
  rate_limited: 429,
  integration_disabled: 503,
  helpdesk_unavailable: 503,
  assistant_unavailable: 503
} as const;
export type HelpdeskProblemCode = keyof typeof PROBLEM_STATUS;

const PROBLEM_TITLES: Record<HelpdeskProblemCode, string> = {
  invalid_request: "The request could not be read",
  validation_failed: "Some fields are invalid",
  too_many_attachments: "Too many attachments",
  attachment_too_large: "Attachment too large",
  attachment_type_unsupported: "Unsupported attachment type",
  idempotency_key_required: "Idempotency-Key header required",
  unauthenticated: "Sign in is required",
  invalid_token: "Invalid service token",
  forbidden_origin: "Request origin is not allowed",
  not_found: "Not found",
  idempotency_conflict: "Idempotency key reused with a different request",
  stale_ticket: "The ticket has changed",
  invalid_transition: "This action is not available for the ticket's current state",
  reopen_window_passed: "The follow-up window has passed",
  rating_window_passed: "The rating window has passed",
  already_rated: "The ticket has already been rated",
  tag_limit_reached: "The ticket already has the maximum number of tags",
  rate_limited: "Too many requests",
  integration_disabled: "Helpdesk integration is not configured",
  helpdesk_unavailable: "Helpdesk is temporarily unavailable",
  assistant_unavailable: "The support assistant is temporarily unavailable"
};

export class HelpdeskProblem extends Error {
  readonly status: number;
  constructor(public readonly code: HelpdeskProblemCode, public readonly detail: string = PROBLEM_TITLES[code], public readonly extra: Record<string, unknown> = {}, public readonly field?: string) {
    super(code);
    this.status = PROBLEM_STATUS[code];
  }
}

export function problemBody(problem: HelpdeskProblem) {
  return {
    type: `${PROBLEM_TYPE_BASE}${problem.code}`,
    title: PROBLEM_TITLES[problem.code],
    status: problem.status,
    detail: problem.detail,
    code: problem.code,
    ...(problem.field ? { field: problem.field } : {}),
    ...problem.extra
  };
}

function invalid(field: string, detail: string): never {
  throw new HelpdeskProblem("validation_failed", detail, {}, field);
}

// ---------------------------------------------------------------- inputs

export type UploadInput = { fileName: string; declaredType: string; bytes: Uint8Array };
export type CreateTicketInput = {
  category: TicketCategory;
  subject: string;
  body: string;
  locale: HelpdeskLocale;
  /** null (or absent) = use the account email. */
  contactEmail?: string | null;
  /** The AI suggestion the learner declined before submitting ("No, still submit"). */
  suggestionId?: string | null;
  /** v2 §4a: chat answers (helpdesk_assist_log ids) to link to the new ticket; at most 10. */
  assistIds?: string[];
  files: UploadInput[];
};
export type LearnerMessageInput = { body: string; expectedSequence: number; files: UploadInput[] };
export type LearnerActionInput = { action: LearnerAction; expectedSequence: number; rating?: number; message?: string };
export type AgentMessageInput = { body: string; internal: boolean; agent: AgentIdentity; expectedSequence: number };
/** expectedSequence is required for claim / propose_resolution and optional (null) for tags and mark_read. */
export type AgentActionInput = { action: AgentAction; agent: AgentIdentity; expectedSequence: number | null; tag?: string };
export type ListCursor = { updatedAt: string; id: string };
export type AgentListQuery = {
  status: TicketStatus | "needs_reply" | null; q: string; limit: number; cursor: ListCursor | null; category?: TicketCategory | null; tag?: string | null;
  /** v2 §4a: only flagged (true) enquiries. */
  flagged?: boolean | null;
  /** v2 §4a: one learner's enquiries (the BackOffice student timeline). */
  learnerId?: string | null;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HelpdeskProblem("invalid_request", "Send a JSON object.");
  return value as Record<string, unknown>;
}

/** Free text: no control characters anywhere (tab, LF and CR are fine), then trimmed, at most max code points. */
function cleanText(raw: string, field: string, max: number): string {
  if (hasControlCharacters(raw)) invalid(field, `${field} must not contain control characters.`);
  const value = raw.trim();
  if (textLength(value) > max) invalid(field, `${field} must be at most ${max} characters.`);
  return value;
}

function boundedText(input: Record<string, unknown>, field: string, max: number): string {
  const raw = input[field];
  if (typeof raw !== "string") invalid(field, `${field} is required.`);
  const value = cleanText(raw, field, max);
  if (isBlankText(value)) invalid(field, `${field} is required.`);
  return value;
}

function oneOf<T extends string>(input: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const value = input[field];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) invalid(field, `${field} must be one of ${allowed.join(", ")}.`);
  return value as T;
}

/** Positive integer; multipart fields arrive as decimal strings, JSON fields as numbers. */
function sequence(input: Record<string, unknown>, fromForm: boolean): number {
  const raw = input.expectedSequence;
  const value = fromForm ? (typeof raw === "string" && /^[0-9]{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : NaN) : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid("expectedSequence", "expectedSequence must be a positive integer.");
  return value;
}

function uploads(files: UploadInput[]): UploadInput[] {
  if (files.length > HELPDESK_LIMITS.filesPerMessage) throw new HelpdeskProblem("too_many_attachments", `Attach at most ${HELPDESK_LIMITS.filesPerMessage} files.`);
  for (const file of files) {
    if (file.bytes.byteLength === 0) invalid("files", "An attached file is empty.");
    if (file.bytes.byteLength > HELPDESK_LIMITS.fileMaxBytes) throw new HelpdeskProblem("attachment_too_large", "Each file must be 10 MB or smaller.");
  }
  return files;
}

function agentIdentity(input: Record<string, unknown>): AgentIdentity {
  const agent = input.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) invalid("agent", "agent { id, name } is required.");
  const value = agent as Record<string, unknown>;
  const rawId = typeof value.id === "string" ? value.id : "";
  const rawName = typeof value.name === "string" ? value.name : "";
  if (hasControlCharacters(rawId) || hasControlCharacters(rawName)) invalid("agent", "agent { id, name } must not contain control characters.");
  const id = rawId.trim();
  const name = rawName.trim();
  if (!id || textLength(id) > HELPDESK_LIMITS.agentIdMax || !name || textLength(name) > HELPDESK_LIMITS.agentNameMax) invalid("agent", "agent { id, name } is required.");
  return { id, name };
}

const EMAIL_PATTERN = /^[^\s@"<>()\[\],;:\\]+@[^\s@"<>()\[\],;:\\]+\.[^\s@"<>()\[\],;:\\]{2,}$/;

/** A plain address (no display name, no header characters), at most 254 characters. */
export function isContactEmail(value: string): boolean {
  return value.length <= HELPDESK_LIMITS.contactEmailMax && !hasControlCharacters(value) && EMAIL_PATTERN.test(value);
}

function optionalContactEmail(input: Record<string, unknown>): string | null {
  const raw = input.contactEmail;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") invalid("contactEmail", "contactEmail must be an email address.");
  if (hasControlCharacters(raw)) invalid("contactEmail", "contactEmail must be a valid email address.");
  const value = raw.trim();
  if (!value) return null;
  if (!isContactEmail(value)) invalid("contactEmail", "contactEmail must be a valid email address.");
  return value;
}

function optionalUuid(input: Record<string, unknown>, field: string): string | null {
  const raw = input[field];
  if (raw === undefined || raw === null || raw === "") return null;
  if (!isUuid(raw)) invalid(field, `${field} must be a UUID.`);
  return raw.toLowerCase();
}

/** Tags are compared case-insensitively: trimmed, inner spaces collapsed, NFKC, lower case. */
export function normaliseTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  if (!value || textLength(value) > HELPDESK_LIMITS.tagMax || hasControlCharacters(value)) return null;
  return value;
}

export function parseCreateTicketInput(fields: Record<string, unknown>, files: UploadInput[]): CreateTicketInput {
  return {
    category: oneOf(fields, "category", TICKET_CATEGORIES),
    subject: boundedText(fields, "subject", HELPDESK_LIMITS.subjectMax),
    body: boundedText(fields, "body", HELPDESK_LIMITS.bodyMax),
    locale: oneOf(fields, "locale", HELPDESK_LOCALES),
    contactEmail: optionalContactEmail(fields),
    suggestionId: optionalUuid(fields, "suggestionId"),
    assistIds: assistIdList(fields.assistIds),
    files: uploads(files)
  };
}

/** v2 §4a: up to 10 distinct assist log ids (multipart repeats the field; one value arrives as a string). */
function assistIdList(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const ids: string[] = [];
  for (const value of values) {
    if (!isUuid(value)) invalid("assistIds", "assistIds must be UUIDs.");
    const id = value.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > HELPDESK_LIMITS.assistIdsPerTicket) invalid("assistIds", `Link at most ${HELPDESK_LIMITS.assistIdsPerTicket} assistant answers.`);
  return ids;
}

export function parseLearnerMessageInput(fields: Record<string, unknown>, files: UploadInput[]): LearnerMessageInput {
  return { body: boundedText(fields, "body", HELPDESK_LIMITS.bodyMax), expectedSequence: sequence(fields, true), files: uploads(files) };
}

export function parseLearnerActionInput(value: unknown): LearnerActionInput {
  const input = record(value);
  const action = oneOf(input, "action", LEARNER_ACTIONS);
  const result: LearnerActionInput = { action, expectedSequence: sequence(input, false) };
  if (action === "rate") {
    const rating = input.rating;
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) invalid("rating", "rating must be an integer from 1 to 5.");
    result.rating = rating;
  }
  if (action === "reject" && input.message !== undefined && input.message !== null) {
    if (typeof input.message !== "string") invalid("message", "message must be text.");
    const message = cleanText(input.message, "message", HELPDESK_LIMITS.bodyMax);
    if (!isBlankText(message)) result.message = message;
  }
  return result;
}

export function parseAgentMessageInput(value: unknown): AgentMessageInput {
  const input = record(value);
  const body = boundedText(input, "body", HELPDESK_LIMITS.bodyMax);
  if (typeof input.internal !== "boolean") invalid("internal", "internal must be true or false.");
  return { body, internal: input.internal, agent: agentIdentity(input), expectedSequence: sequence(input, false) };
}

export function parseAgentActionInput(value: unknown): AgentActionInput {
  const input = record(value);
  const action = oneOf(input, "action", AGENT_ACTIONS);
  const agent = agentIdentity(input);
  if (action === "claim" || action === "propose_resolution" || action === "flag" || action === "unflag") return { action, agent, expectedSequence: sequence(input, false) };
  const expectedSequence = input.expectedSequence === undefined || input.expectedSequence === null ? null : sequence(input, false);
  if (action === "mark_read") return { action, agent, expectedSequence };
  const tag = normaliseTag(input.tag);
  if (!tag) invalid("tag", `tag must be 1 to ${HELPDESK_LIMITS.tagMax} characters.`);
  return { action, agent, expectedSequence, tag };
}

export function parseSuggestInput(value: unknown): SuggestInput {
  const input = record(value);
  return {
    category: oneOf(input, "category", TICKET_CATEGORIES),
    subject: boundedText(input, "subject", HELPDESK_LIMITS.subjectMax),
    message: boundedText(input, "message", HELPDESK_LIMITS.bodyMax),
    locale: oneOf(input, "locale", HELPDESK_LOCALES)
  };
}

export function parseSuggestionOutcome(value: unknown): SuggestionOutcome {
  return oneOf(record(value), "outcome", SUGGESTION_OUTCOMES);
}

/** POST /api/helpdesk/assistant: { message (1..500 code points), locale, faqId? } (v2 §4b). */
export function parseAssistantInput(value: unknown): AssistantInput {
  const input = record(value);
  return {
    message: boundedText(input, "message", HELPDESK_LIMITS.assistQuestionMax),
    locale: oneOf(input, "locale", HELPDESK_LOCALES),
    faqId: optionalUuid(input, "faqId")
  };
}

/** POST /api/helpdesk/assistant/{id}/feedback: { helpful: boolean }. */
export function parseAssistantFeedback(value: unknown): boolean {
  const input = record(value);
  if (typeof input.helpful !== "boolean") invalid("helpful", "helpful must be true or false.");
  return input.helpful;
}

export type HelpCentreQuery = { q: string; category: FaqCategory | null; faq: string | null };

/** /{locale}/help?q=&category=&faq= — anything unreadable is ignored rather than refused (it is a public page). */
export function parseHelpCentreQuery(params: Record<string, string | string[] | undefined>): HelpCentreQuery {
  const first = (name: string) => { const raw = params[name]; return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : ""; };
  const rawQ = first("q");
  const q = hasControlCharacters(rawQ) ? "" : [...rawQ.trim()].slice(0, HELPDESK_LIMITS.queryMax).join("");
  const category = (FAQ_CATEGORIES as readonly string[]).includes(first("category")) ? first("category") as FaqCategory : null;
  const faq = isUuid(first("faq")) ? first("faq").toLowerCase() : null;
  return { q, category, faq };
}

export function parseLocaleParam(params: URLSearchParams): HelpdeskLocale {
  return oneOf({ locale: params.get("locale") ?? "" }, "locale", HELPDESK_LOCALES);
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): ListCursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)) && isUuid(value.id)) return { updatedAt: new Date(value.updatedAt).toISOString(), id: value.id.toLowerCase() };
  } catch { /* fall through */ }
  return invalid("cursor", "cursor is not valid.");
}

export function parseAgentListQuery(params: URLSearchParams): AgentListQuery {
  const statusRaw = (params.get("status") || "").trim();
  let status: AgentListQuery["status"] = null;
  if (statusRaw && statusRaw !== "all") {
    if (statusRaw !== "needs_reply" && !(TICKET_STATUSES as readonly string[]).includes(statusRaw)) invalid("status", "status is not valid.");
    status = statusRaw as AgentListQuery["status"];
  }
  const q = cleanText(params.get("q") || "", "q", HELPDESK_LIMITS.queryMax);
  let limit: number = HELPDESK_LIMITS.listLimitDefault;
  const limitRaw = params.get("limit");
  if (limitRaw !== null && limitRaw !== "") {
    if (!/^[0-9]{1,6}$/.test(limitRaw) || Number(limitRaw) < 1) invalid("limit", "limit must be a positive integer.");
    limit = Math.min(Number(limitRaw), HELPDESK_LIMITS.listLimitMax);
  }
  const cursorRaw = params.get("cursor");
  const categoryRaw = (params.get("category") || "").trim();
  if (categoryRaw && !(TICKET_CATEGORIES as readonly string[]).includes(categoryRaw)) invalid("category", "category is not valid.");
  const tagRaw = params.get("tag");
  let tag: string | null = null;
  if (tagRaw !== null && tagRaw.trim() !== "") {
    tag = normaliseTag(tagRaw);
    if (!tag) invalid("tag", `tag must be at most ${HELPDESK_LIMITS.tagMax} characters.`);
  }
  const flaggedRaw = (params.get("flagged") || "").trim();
  if (flaggedRaw && flaggedRaw !== "true" && flaggedRaw !== "false") invalid("flagged", "flagged must be true or false.");
  const learnerRaw = params.get("learnerId") || "";
  if (hasControlCharacters(learnerRaw) || textLength(learnerRaw.trim()) > HELPDESK_LIMITS.learnerIdMax) invalid("learnerId", "learnerId is not valid.");
  return {
    status, q, limit, cursor: cursorRaw ? decodeCursor(cursorRaw) : null, category: (categoryRaw || null) as TicketCategory | null, tag,
    flagged: flaggedRaw === "true" ? true : null, learnerId: learnerRaw.trim() || null
  };
}

/** Idempotency-Key (IETF httpapi draft): an sf-string; Learning Guide keys are UUIDs. */
export function parseIdempotencyKey(header: string | null): string {
  const raw = (header || "").trim();
  const value = raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"") ? raw.slice(1, -1) : raw;
  if (!isUuid(value)) throw new HelpdeskProblem("idempotency_key_required", "Send an Idempotency-Key header containing a UUID.");
  return value.toLowerCase();
}

export function isTicketId(value: unknown): value is string {
  return isUuid(value);
}
