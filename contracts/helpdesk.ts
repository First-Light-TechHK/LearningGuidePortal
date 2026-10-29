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
  /** v3 §1: "You might be asking" questions shown when there is no answer (Admin sends 0-3). */
  alternativesMax: 3,
  /** v3: Admin refuses more than 20 shownFaqIds (400). */
  shownFaqIdsMax: 20,
  learnerIdMax: 128,
  /** v4 Part A: an order number as the order owner writes it (order_<ms>_<hex>); letters, digits, _ and - only. */
  orderIdMax: 64,
  /** v5 (contract v6): suggest context.recentTurns, the learner's own earlier words only (Admin refuses more with 400). */
  recentTurnsMax: 3,
  /** v5 (contract v6): each recent turn, in code points (Admin refuses longer with 400; Portal clips). */
  recentTurnMax: 500
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
  /** v4 Part A: the learner's order this enquiry is about (checked by Portal when it was created), or null. */
  orderId: string | null;
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

/** v4 Part A: the order owner's values (services/productStore.ts ProductOrder); Admin labels each of them. */
export const ORDER_STATUSES = ["paid", "pending", "failed", "canceled", "refunded"] as const;
export const ORDER_KINDS = ["purchase", "trial_activation", "upgrade"] as const;
export const PAYMENT_MODES = ["demo", "stripe"] as const;

/**
 * v4 Part A "Order" block: a read-only projection built by Portal code from
 * the learner's own order record (modules/helpdesk/orderDirectory.ts). These
 * fields and nothing else: no card data, no Stripe ids or secrets, no
 * addresses. The AI agent never receives it.
 */
export type OrderProjection = {
  /** The order number the learner sees on the receipt and in the payment records. */
  id: string;
  status: (typeof ORDER_STATUSES)[number];
  /** In the currency's minor units, as stored (3900 = 39.00). */
  amount: number;
  /** ISO 4217, lower case as stored ("usd"). */
  currency: string;
  planName: string;
  kind: (typeof ORDER_KINDS)[number];
  createdAt: string;
  paymentMode: (typeof PAYMENT_MODES)[number];
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
  /** v4 Part A: the linked order, read live from the order record; null without one (or while the order store is unavailable). */
  order: OrderProjection | null;
};

export type TicketCounts = Record<TicketStatus, number> & { needs_reply: number; all: number };
export type LearnerTicketList = { tickets: TicketSummary[] };
export type AgentTicketList = { tickets: AgentTicketSummary[]; nextCursor: string | null; counts: TicketCounts };

// ---------------------------------------------------------------- Admin-owned FAQs and the AI Support Assistant (v2 §1, §2, §4)

/** v2 §1: Help Centre topics (Admin owns the FAQs; Portal only reads published ones). */
export const FAQ_CATEGORIES = ["account_technical", "courses_learning", "payments_subscriptions", "other"] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];
/**
 * v5 Part A: the learner situation signals Portal computes by code from its own stores (true / false, no values).
 * They never leave Portal: Admin and the model never receive them; only their enum names are logged.
 */
export const SITUATION_SIGNALS = ["trial_ending", "payment_failed", "payment_pending", "recent_purchase", "subscription_cancelled", "subscription_expired", "email_unverified", "open_ticket_waiting", "from_order"] as const;
export type SituationSignal = (typeof SITUATION_SIGNALS)[number];
/**
 * v5 Part A: the signals an Admin FAQ can be tagged with, in the order Portal picks the "you may be having" chips.
 * open_ticket_waiting is not an FAQ (Portal shows a fixed card linking the enquiry).
 */
export const FAQ_SIGNALS = ["payment_failed", "payment_pending", "recent_purchase", "trial_ending", "subscription_expired", "subscription_cancelled", "email_unverified", "from_order"] as const satisfies readonly SituationSignal[];
export type FaqSignal = (typeof FAQ_SIGNALS)[number];
export const isFaqSignal = (value: unknown): value is FaqSignal => (FAQ_SIGNALS as readonly unknown[]).includes(value);
/** A published FAQ in one locale; answer is the Markdown subset (modules/helpdesk/markdown.ts). signals (v5, contract v6): [] from an older Admin. */
export type HelpFaq = { id: string; category: FaqCategory; popular: boolean; question: string; answer: string; signals: FaqSignal[]; updatedAt: string };
export type FaqFilter = { popular?: boolean; category?: FaqCategory | null; q?: string; limit?: number };
/** One stored answer, shown verbatim. */
export type HelpdeskSuggestion = { id: string; faqId: string; question: string; answer: string };
/**
 * v3 §1 "You might be asking / 你可能想问": an FAQ the learner may pick when
 * there is no answer. Admin chooses them in code (retrieval rank, else popular
 * FAQs), never by asking the model; picking one asks it as a chip (faqId).
 */
export type HelpdeskAlternative = { faqId: string; question: string };
/** POST /api/helpdesk/suggestions. alternatives (v3, additive) is [] whenever suggestion is set, and when rate limited or Admin failed. */
export type SuggestionResponse = { suggestion: HelpdeskSuggestion | null; alternatives: HelpdeskAlternative[] };
/** Admin's POST /api/integration/helpdesk/suggest answer as Portal reads it (contract v4); turn (v6) only when Admin sent the v5 fields. */
export type AdminSuggestReply = SuggestionResponse & { turn?: SuggestTurn };
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
/**
 * Portal -> Admin POST /api/integration/helpdesk/suggest (v2 §2).
 * runId is the assist log row id Portal records (Admin's trace run and, when it answers, its suggestion id);
 * parentRunId is the first row of the learner's current conversation (null when this run starts one).
 * shownFaqIds (v3, additive): the FAQs that conversation already showed, newest first, at most
 * HELPDESK_LIMITS.shownFaqIdsMax; Admin never offers them as alternatives. Left out when there are none.
 */
export type AdminSuggestRequest = { learnerId: string; locale: HelpdeskLocale; source: AssistSource; category?: TicketCategory; subject?: string; message: string; faqId?: string; shownFaqIds?: string[]; context?: SuggestRequestContext; runId: string; parentRunId: string | null };
/** POST /api/helpdesk/assistant body (v2 §4b). */
export type AssistantInput = { message: string; locale: HelpdeskLocale; faqId: string | null };
/** id is the assist log row (link it with assistIds); reply null = show the fallback copy, then the alternatives (v3, additive) as chips. */
export type AssistantResponse = { id: string; reply: HelpdeskSuggestion | null; alternatives: HelpdeskAlternative[] };
/** POST /api/helpdesk/assistant/{id}/rating answer (v3 §2): the rating stored for that answer. */
export type AssistantRatingResponse = { id: string; rating: number };
export type AssistantFeedbackResponse = { id: string; feedback: AssistFeedback | null };
/** BackOffice AI block (v2 §3d / §4a). */
export type AiAssistView = { id: string; source: AssistSource; question: string; faqId: string | null; faqQuestion: string | null; answer: string | null; feedback: AssistFeedback | null; createdAt: string; /** v3 §2: the learner's 1-5 rating of this answer, or null (none given, or skipped). */ rating: number | null };

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
  answer_already_rated: 409,
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
  answer_already_rated: "This answer has already been rated",
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
  /** v4 Part A: the learner's own order the enquiry is about; the server checks it belongs to them. */
  orderId?: string | null;
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
    orderId: optionalOrderId(fields.orderId),
    files: uploads(files)
  };
}

const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** v4 Part A: the order number as the order owner wrote it (trimmed, never rewritten); empty = none. Ownership is checked by the service. */
function optionalOrderId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") invalid("orderId", "orderId must be an order number.");
  const value = raw.trim();
  if (!value) return null;
  if (value.length > HELPDESK_LIMITS.orderIdMax || !ORDER_ID_PATTERN.test(value)) invalid("orderId", "orderId is not a valid order number.");
  return value;
}

/** v4 Part A: the Contact Support page's ?orderId= (anything unreadable is ignored, like the Help Centre query). */
export function parseOrderIdParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  try { return optionalOrderId(value); } catch { return null; }
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

/** POST /api/helpdesk/assistant/{id}/rating: { rating: 1..5 } (v3 §2). */
export function parseAssistantRating(value: unknown): number {
  const rating = record(value).rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) invalid("rating", "rating must be an integer from 1 to 5.");
  return rating;
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

// ---------------------------------------------------------------- Helpdesk v5 (contract fixture v6): FAQ question trees and the suggest turn
// Specs: lg-helpdesk/helpdesk-v5-faq-graph-design.md (§1, §2.2, §4, §6) and helpdesk-v5-context-chips-and-smalltalk.md (Parts A, B, D, H).
// Admin owns the graph, the releases, the block split and the guard; Portal caches the published release, renders
// blocks by id and validates clicks against the cached edges. Clicks never call the model or Admin.

/** answer = an FAQ card; choice = one short question with 2-4 option buttons (it states no facts). */
export const FAQ_NODE_TYPES = ["answer", "choice"] as const;
export type FaqNodeType = (typeof FAQ_NODE_TYPES)[number];
/** follow_up = a chip under an answer; option = an A/B/C/D button on a choice node. */
export const FAQ_EDGE_KINDS = ["follow_up", "option"] as const;
export type FaqEdgeKind = (typeof FAQ_EDGE_KINDS)[number];
/** One block of an approved answer (b1..bn, split by Admin's code at release time); text is that block's Markdown, rendered verbatim. */
export type FaqBlock = { id: string; text: string };
/** A node of the published release in one locale. blocks: at least one for an answer node, [] for a choice node. */
export type FaqNode = { id: string; key: string; type: FaqNodeType; entry: boolean; category: FaqCategory; popular: boolean; question: string; answer: string; blocks: FaqBlock[]; signals: FaqSignal[] };
/** An edge of the published release in one locale; label is resolved (the child's question unless staff overrode it). position orders the edges of one parent. */
export type FaqEdge = { parentId: string; childId: string; kind: FaqEdgeKind; position: number; label: string };
/**
 * GET /api/integration/helpdesk/faq-release/current?locale= (Admin, Bearer ADMIN_HELPDESK_TOKEN): the whole published graph.
 * ETag "v<version>"; If-None-Match -> 304; 404 (code no_release, or an older Admin without the route) = no release yet,
 * so Portal keeps using the per-FAQ published list.
 */
export type FaqRelease = { version: number; publishedAt: string; locale: HelpdeskLocale; nodes: FaqNode[]; edges: FaqEdge[] };

/** What Admin's suggest answer is (v6, only when the request carried context). */
export const SUGGEST_KINDS = ["answer", "smalltalk", "clarify", "no_match"] as const;
export type SuggestKind = (typeof SUGGEST_KINDS)[number];
/** pick_faq's intent: the v2 seven plus greeting (hi, are you there), farewell (thanks, bye), vague (wants help, no question yet), clarify (asks about the card shown). */
export const SUGGEST_INTENTS = ["question", "own_account", "someone_else", "exception", "private_data", "instructions", "off_topic", "greeting", "farewell", "vague", "clarify"] as const;
export type SuggestIntent = (typeof SUGGEST_INTENTS)[number];
export const CONFIDENCE_LEVELS = ["sure", "unsure"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
/** passed = the model's short line is shown; fallback = Admin's fixed template (or, for clarify, no explanation). */
export const GUARD_RESULTS = ["passed", "fallback"] as const;
export type GuardResult = (typeof GUARD_RESULTS)[number];
export const GUARD_REASONS = ["missing", "too_long", "link", "email", "digit", "markup", "blocked_phrase", "ai_filler", "script", "ungrounded", "not_covered", "timeout", "error"] as const;
export type GuardReason = (typeof GUARD_REASONS)[number];
export const GUARDED_FIELDS = ["opening", "closing", "reply", "explanation"] as const;
export type GuardedField = (typeof GUARDED_FIELDS)[number];
export type SuggestGuard = { result: GuardResult; reason: GuardReason | null; fallback: GuardedField[] };
/**
 * The v6 suggest fields as Portal reads them (enum codes and short texts that already passed Admin's guard or are
 * its fixed template). kind answer: nodeId = the suggestion's faqId; opening and closing frame an answer node (both
 * null for a choice node); blocks = the excerpt's block ids ([] = the whole answer). smalltalk: reply. clarify:
 * nodeId = the card on screen; covered with explanation, or not covered (explanation null: Portal shows its fixed
 * copy and the handover). releaseVersion null = no release yet (per-FAQ publishing).
 */
export type SuggestTurn = {
  kind: SuggestKind; intent: SuggestIntent | null; confidence: ConfidenceLevel | null; nodeId: string | null; blocks: string[];
  opening: string | null; closing: string | null; reply: string | null; explanation: string | null; covered: boolean | null;
  guard: SuggestGuard | null; releaseVersion: number | null;
};
/** v6 suggest request context (only a v5 Portal sends it; an older Admin ignores it). recentTurns: the learner's own earlier words, oldest first. */
export type SuggestRequestContext = { nodeId?: string; sessionId?: string; recentTurns?: string[] };

const pick = <T extends string>(values: readonly T[], value: unknown): T | null => ((values as readonly unknown[]).includes(value) ? (value as T) : null);
const shortText = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const BLOCK_ID = /^b[1-9]\d{0,3}$/;
const positiveInt = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null);

/**
 * The context Portal sends, in code: valid ids only (lower case), the last HELPDESK_LIMITS.recentTurnsMax non-empty
 * learner turns, each clipped to recentTurnMax code points. Nothing about the learner's account ever goes in.
 */
export function buildSuggestContext(input: { nodeId?: string | null; sessionId?: string | null; recentTurns?: readonly string[] }): SuggestRequestContext {
  const context: SuggestRequestContext = {};
  if (isUuid(input.nodeId)) context.nodeId = input.nodeId.toLowerCase();
  if (isUuid(input.sessionId)) context.sessionId = input.sessionId.toLowerCase();
  const turns = (input.recentTurns ?? [])
    .map((turn) => [...turn.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()].slice(0, HELPDESK_LIMITS.recentTurnMax).join("").trim())
    .filter((turn) => turn !== "")
    .slice(-HELPDESK_LIMITS.recentTurnsMax);
  if (turns.length) context.recentTurns = turns;
  return context;
}

/** Admin's v6 suggest fields, read tolerantly; null when there are none (an older Admin, or a request without context). */
export function parseSuggestTurn(value: unknown): SuggestTurn | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const kind = pick(SUGGEST_KINDS, item.kind);
  if (!kind) return null;
  let guard: SuggestGuard | null = null;
  if (item.guard && typeof item.guard === "object") {
    const raw = item.guard as Record<string, unknown>;
    const result = pick(GUARD_RESULTS, raw.result);
    if (result) guard = { result, reason: pick(GUARD_REASONS, raw.reason), fallback: Array.isArray(raw.fallback) ? raw.fallback.filter((field): field is GuardedField => pick(GUARDED_FIELDS, field) !== null) : [] };
  }
  const blocks = Array.isArray(item.blocks) ? item.blocks.filter((id): id is string => typeof id === "string" && BLOCK_ID.test(id)) : [];
  return {
    kind, intent: pick(SUGGEST_INTENTS, item.intent), confidence: pick(CONFIDENCE_LEVELS, item.confidence), nodeId: isUuid(item.nodeId) ? item.nodeId.toLowerCase() : null,
    blocks: [...new Set(blocks)], opening: shortText(item.opening), closing: shortText(item.closing), reply: shortText(item.reply), explanation: shortText(item.explanation),
    covered: typeof item.covered === "boolean" ? item.covered : null, guard, releaseVersion: positiveInt(item.releaseVersion)
  };
}

/**
 * The published release as Admin sends it, read tolerantly: a malformed node or edge is dropped (and so is any edge
 * whose ends are not both in the release, so a click can never reach a node Portal does not have); a malformed
 * version, locale or node list makes the whole release unusable (null: keep the last good one).
 */
export function parseFaqRelease(value: unknown): FaqRelease | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const version = positiveInt(raw.version);
  const locale = pick(HELPDESK_LOCALES, raw.locale);
  if (!version || !locale || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
  const nodes: FaqNode[] = [];
  const ids = new Set<string>();
  for (const entry of raw.nodes) {
    if (!entry || typeof entry !== "object") continue;
    const node = entry as Record<string, unknown>;
    const type = pick(FAQ_NODE_TYPES, node.type);
    const category = pick(FAQ_CATEGORIES, node.category);
    if (!isUuid(node.id) || !type || !category || !shortText(node.key) || !shortText(node.question) || !shortText(node.answer)) continue;
    const id = node.id.toLowerCase();
    if (ids.has(id)) continue;
    const blocks = Array.isArray(node.blocks) ? node.blocks.filter((block): block is FaqBlock => Boolean(block) && typeof block === "object" && BLOCK_ID.test(String((block as FaqBlock).id)) && shortText((block as FaqBlock).text) !== null).map((block) => ({ id: block.id, text: block.text })) : [];
    const signals = Array.isArray(node.signals) ? FAQ_SIGNALS.filter((signal) => (node.signals as unknown[]).includes(signal)) : [];
    ids.add(id);
    nodes.push({ id, key: String(node.key), type, entry: node.entry === true, category, popular: node.popular === true, question: String(node.question), answer: String(node.answer), blocks: type === "answer" ? blocks : [], signals });
  }
  const edges: FaqEdge[] = [];
  for (const entry of raw.edges) {
    if (!entry || typeof entry !== "object") continue;
    const edge = entry as Record<string, unknown>;
    const kind = pick(FAQ_EDGE_KINDS, edge.kind);
    if (!kind || !isUuid(edge.parentId) || !isUuid(edge.childId) || !shortText(edge.label) || typeof edge.position !== "number" || !Number.isInteger(edge.position) || edge.position < 0) continue;
    const parentId = edge.parentId.toLowerCase();
    const childId = edge.childId.toLowerCase();
    if (parentId === childId || !ids.has(parentId) || !ids.has(childId)) continue;
    edges.push({ parentId, childId, kind, position: edge.position, label: String(edge.label) });
  }
  return { version, publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : "", locale, nodes, edges };
}

// ---------------------------------------------------------------- Helpdesk v5, the learner chat API (Portal only; Admin never sees these)
// Specs: helpdesk-v5-context-chips-and-smalltalk.md (Parts A, B, D, H) and helpdesk-v5-faq-graph-design.md (§3, §4).
// A chat session is Portal's own record (helpdesk_chat_sessions, migration 023); every turn is one helpdesk_assist_log row.

/** How a turn came about: typed by the learner, or a click (code only, never the model or Admin). */
export const ASSIST_VIAS = ["typed", "follow_up", "option", "starter", "signal", "alternative"] as const;
export type AssistVia = (typeof ASSIST_VIAS)[number];
/** The clicks: follow_up / option need the edge from the card on screen; starter / signal / alternative open an entry node. */
export const CLICK_VIAS = ["follow_up", "option", "starter", "signal", "alternative"] as const;
export type ClickVia = (typeof CLICK_VIAS)[number];
/** Why a session ended (graph design §3). */
export const CHAT_END_REASONS = ["idle", "ended_by_learner", "handover", "ticket"] as const;
export type ChatEndReason = (typeof CHAT_END_REASONS)[number];
/** What the learner may end a session with (ticket is set by Portal when an enquiry links the chat). */
export const LEARNER_END_REASONS = ["idle", "ended_by_learner", "handover"] as const satisfies readonly ChatEndReason[];
export type LearnerEndReason = (typeof LEARNER_END_REASONS)[number];

/** A next step under the shown card: a follow-up chip (answer node) or an A/B/C/D option (choice node); label is the edge's resolved label. */
export type AssistantNextStep = { nodeId: string; label: string };
/**
 * The v5 part of an assistant turn, as Portal returns it to its own chat. Every string is plain text (never Markdown or
 * HTML), already through Admin's guard or a fixed template, and through Portal's own check (modules/helpdesk/assistantTurn.ts).
 * - answer: reply is the FAQ card verbatim. opening / closing frame it (null for a choice node, whose prompt is reply.answer
 *   and whose options are next). excerpt: the blocks to show (verbatim, from the cached release); null = the whole answer and
 *   no "show the full answer".
 * - smalltalk: reply holds the short line; no card. intent says which (greeting / vague / farewell / off_topic).
 * - clarify: explanation of the card on screen (source), or covered false (explanation null: the fixed copy and the handover card).
 *   uncovered says which fixed copy: not_covered = the model said the card does not say it ("the answer does not cover
 *   that point"); unavailable = the explanation could not be given (timed out, failed, or a guard refused it), so the
 *   copy makes no claim about the card. Null when covered or not a clarify; missing (an older Portal) = not_covered.
 * - no_match: the fallback copy and the v3 alternatives.
 * unsolved: this turn counts toward v4's "2 unsolved in a row" (no answer, or clarify not covered).
 * countsAsQuestion: toward v4's 8-question check-in (smalltalk and clarify do not count).
 */
export type AssistantTurn = {
  kind: SuggestKind; intent: SuggestIntent | null; via: AssistVia; nodeId: string | null; nodeType: FaqNodeType | null;
  opening: string | null; closing: string | null; reply: string | null; explanation: string | null; covered: boolean | null;
  uncovered?: "not_covered" | "unavailable" | null;
  excerpt: FaqBlock[] | null; next: { kind: FaqEdgeKind; steps: AssistantNextStep[] } | null; source: { faqId: string; question: string } | null;
  releaseVersion: number | null; sessionId: string; turnIndex: number; unsolved: boolean; countsAsQuestion: boolean;
};
/** POST /api/helpdesk/assistant and /assistant/click (v5): the v3 answer plus turn (additive). */
export type AssistantTurnResponse = AssistantResponse & { turn: AssistantTurn };
/** A situation chip (Part A §3): an entry FAQ / node whose question is the chip text; reason signal = it matched the learner's situation. */
export type SituationChip = { id: string; question: string; reason: "signal" | "popular" };
/**
 * POST /api/helpdesk/assistant/sessions (v5): a new chat session with the chips worked out by Portal code from the learner's
 * own records. situational: at least one chip matched a signal ("你可能遇到的问题" instead of "试试问这些问题"). waitingTicket:
 * the learner's newest enquiry waiting for their reply (the fixed card), or null. No signal names, amounts, order numbers or dates.
 */
export type AssistantSessionResponse = { sessionId: string; chips: SituationChip[]; situational: boolean; waitingTicket: { id: string; number: string } | null; releaseVersion: number | null };
/** POST /api/helpdesk/assistant/click body (v5): a click is checked against the cached release's edges, never asked of the model. */
export type AssistantClickInput = { locale: HelpdeskLocale; nodeId: string; fromNodeId: string | null; via: ClickVia; sessionId: string | null; label: string | null };
export type AssistantSessionInput = { locale: HelpdeskLocale; orderId: string | null };

function optionalSessionId(input: Record<string, unknown>): string | null {
  return optionalUuid(input, "sessionId");
}

/** POST /api/helpdesk/assistant (v5): { message, locale, faqId?, sessionId?, via? }; via (a chip's reason) only with faqId. */
export function parseAssistantTurnInput(value: unknown): AssistantInput & { sessionId: string | null; via: ClickVia | null } {
  const base = parseAssistantInput(value);
  const input = record(value);
  let via: ClickVia | null = null;
  if (input.via !== undefined && input.via !== null) {
    via = oneOf(input, "via", ["starter", "signal", "alternative"] as const);
    if (!base.faqId) invalid("via", "via is only for a chip (faqId).");
  }
  return { ...base, sessionId: optionalSessionId(input), via };
}

/** POST /api/helpdesk/assistant/click: { locale, nodeId, fromNodeId?, via, sessionId?, label? }. */
export function parseAssistantClick(value: unknown): AssistantClickInput {
  const input = record(value);
  const locale = oneOf(input, "locale", HELPDESK_LOCALES);
  const via = oneOf(input, "via", CLICK_VIAS);
  if (!isUuid(input.nodeId)) invalid("nodeId", "nodeId must be a UUID.");
  const fromNodeId = optionalUuid(input, "fromNodeId");
  if ((via === "follow_up" || via === "option") && !fromNodeId) invalid("fromNodeId", "fromNodeId is required for a follow-up or an option.");
  let label: string | null = null;
  if (input.label !== undefined && input.label !== null) {
    if (typeof input.label !== "string") invalid("label", "label must be text.");
    const text = cleanText(input.label, "label", HELPDESK_LIMITS.assistQuestionMax);
    label = isBlankText(text) ? null : text;
  }
  return { locale, nodeId: input.nodeId.toLowerCase(), fromNodeId, via, sessionId: optionalSessionId(input), label };
}

/** POST /api/helpdesk/assistant/sessions: { locale, orderId? } (orderId: Contact Support opened from an order; checked to be the learner's). */
export function parseAssistantSessionInput(value: unknown): AssistantSessionInput {
  const input = record(value);
  return { locale: oneOf(input, "locale", HELPDESK_LOCALES), orderId: optionalOrderId(input.orderId) };
}

/** POST /api/helpdesk/assistant/sessions/{id}/end: { reason: idle | ended_by_learner | handover }. */
export function parseChatEndReason(value: unknown): LearnerEndReason {
  return oneOf(record(value), "reason", LEARNER_END_REASONS);
}

// ---------------------------------------------------------------- Helpdesk v5 Part G (contract fixture v7): the flywheel feed and Portal's jobs
// Spec: helpdesk-v5-context-chips-and-smalltalk.md Part G (G1 capture, G2 clean) and helpdesk-v5-faq-graph-design.md §3, §5.5.
// Portal is the single writer of learner text. Admin's nightly gap mining reads every turn through
// GET /api/integration/helpdesk/insights (bearer, read-only, paged): the learner's words only after the code-only scrubber
// (modules/helpdesk/piiScrubber.ts), the turn's labels as enum names, never a learner id, name, email, order or plan.

/** Why a ticket closed (helpdesk_tickets.close_reason). */
export const CLOSE_REASONS = ["cancelled", "user_confirmed", "user_closed", "auto_confirmed"] as const satisfies readonly CloseReason[];
/** What a turn was (helpdesk_assist_log.kind): Admin's suggest kinds and Portal's own handover. */
export const TURN_KINDS = [...SUGGEST_KINDS, "handover"] as const;
export type TurnKind = (typeof TURN_KINDS)[number];
/** The guard column: passed, fallback, or the reason code of the string that was refused (Admin's, or Portal's own check). */
export const TURN_GUARDS = [...GUARD_RESULTS, ...GUARD_REASONS] as const;
export type TurnGuard = (typeof TURN_GUARDS)[number];
/** The placeholders the scrubber writes (modules/helpdesk/piiScrubber.ts PII_KINDS). */
export const PII_PLACEHOLDER_KINDS = ["url", "email", "token", "id", "order", "ticket", "student_id", "handle", "ip", "phone", "card", "number", "name"] as const;

export const INSIGHT_LIMITS = {
  pageDefault: 200,
  pageMax: 500,
  /** The learner's scrubbed text, at most this many code points (the assist log keeps 500). */
  textMax: 500,
  /** Turns newer than this are left for the next read (a turn still being written, a clock a little behind). */
  settleMs: 60_000,
  /** The agent's reply on a resolved enquiry, scrubbed, at most this many code points. */
  agentReplyMax: 2000,
  /** The learner's ticket within this long after a turn counts as "a ticket after the chat" (G6: AI-solved = none within 24 h). */
  ticketAfterMs: 24 * 3_600_000
} as const;

/**
 * The enquiry a turn led to (helpdesk_assist_outcomes, migration 024): the ticket the chat was linked to, otherwise the
 * learner's next enquiry within 24 hours. resolvedByAgent: the learner confirmed the agent's proposed resolution, or it
 * auto-confirmed. agentReply: the agent's last public reply, scrubbed, only when resolvedByAgent (a human answer, the
 * draft source for a new FAQ; Admin marks any draft 草稿 待核实). No ticket id, number, subject or contact.
 */
export type InsightTicket = { linked: boolean; status: TicketStatus; closeReason: CloseReason | null; resolvedByAgent: boolean; agentReplied: boolean; agentReply: string | null };

/**
 * One assist log row as the flywheel sees it. text: what the learner typed (chat), the chip or step label (a click), or the
 * enquiry subject (submit), always scrubbed. sessionId / turnIndex rebuild the path (null before v5 and for submit checks);
 * lastTurn: the session's newest turn (null without a session). answered: a card was shown. vote: the "Helpful?" or submit
 * outcome; rating: the 1-5 rating. handover: the chat was handed to a person after this turn (kind handover, or the
 * session's last turn when it ended with handover or an enquiry). ticketAfterChat: an enquiry followed (linked, or the
 * learner's next one within 24 hours). signals: the session's situation signals, enum names only.
 */
export type InsightTurn = {
  id: string; createdAt: string; source: AssistSource; locale: HelpdeskLocale; text: string;
  sessionId: string | null; turnIndex: number | null; lastTurn: boolean | null; sessionEndReason: ChatEndReason | null;
  kind: TurnKind | null; intent: SuggestIntent | null; guard: TurnGuard | null; via: AssistVia | null;
  faqId: string | null; nodeId: string | null; parentNodeId: string | null; releaseVersion: number | null;
  answered: boolean; vote: AssistFeedback | null; rating: number | null; covered: boolean | null; expanded: boolean | null;
  handover: boolean; ticketAfterChat: boolean; ticket: InsightTicket | null; signals: SituationSignal[];
};

/** GET /api/integration/helpdesk/insights: oldest first by (createdAt, id); until is the window's end, the same on every page. */
export type InsightsPage = { turns: InsightTurn[]; nextCursor: string | null; until: string };
export type InsightsCursor = { createdAt: string; id: string; until: string };
export type InsightsQuery = { since: string; until: string | null; cursor: InsightsCursor | null; limit: number };

function isoParam(params: URLSearchParams, field: string, required: boolean): string | null {
  const raw = (params.get(field) || "").trim();
  if (!raw) return required ? invalid(field, `${field} is required (an ISO 8601 date-time).`) : null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(raw) || !Number.isFinite(Date.parse(raw))) invalid(field, `${field} must be an ISO 8601 date-time.`);
  return new Date(raw).toISOString();
}

export function encodeInsightsCursor(cursor: InsightsCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeInsightsCursor(raw: string): InsightsCursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) && isUuid(value.id) && typeof value.until === "string" && Number.isFinite(Date.parse(value.until))) {
      return { createdAt: new Date(value.createdAt).toISOString(), id: value.id.toLowerCase(), until: new Date(value.until).toISOString() };
    }
  } catch { /* fall through */ }
  return invalid("cursor", "cursor is not valid.");
}

/** ?since= (required) &until= &cursor= &limit= (1-500, default 200). A cursor keeps the first page's until. */
export function parseInsightsQuery(params: URLSearchParams): InsightsQuery {
  const since = isoParam(params, "since", true) as string;
  const until = isoParam(params, "until", false);
  if (until !== null && until < since) invalid("until", "until must not be before since.");
  let limit: number = INSIGHT_LIMITS.pageDefault;
  const limitRaw = params.get("limit");
  if (limitRaw !== null && limitRaw !== "") {
    if (!/^[0-9]{1,6}$/.test(limitRaw) || Number(limitRaw) < 1) invalid("limit", "limit must be a positive integer.");
    limit = Math.min(Number(limitRaw), INSIGHT_LIMITS.pageMax);
  }
  const cursorRaw = params.get("cursor");
  return { since, until, cursor: cursorRaw ? decodeInsightsCursor(cursorRaw) : null, limit };
}

/** Portal's background jobs (helpdesk_job_runs, migration 024). assist_retention: after 180 days only scrubbed text stays. */
export const HELPDESK_JOBS = ["assist_retention"] as const;
export type HelpdeskJob = (typeof HELPDESK_JOBS)[number];
export const JOB_TRIGGERS = ["schedule", "manual"] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];
export const JOB_STATUSES = ["running", "succeeded", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const ASSIST_RETENTION_DAYS = 180;

/** One run: day is its UTC date; cutoff the createdAt before which raw text is replaced; moreDue: it stopped at its batch bound. */
export type HelpdeskJobRun = {
  id: string; job: HelpdeskJob; day: string; trigger: JobTrigger; status: JobStatus; attempts: number; startedAt: string; finishedAt: string | null;
  cutoff: string; rowsScrubbed: number; moreDue: boolean; requestedBy: AgentIdentity | null; errorCode: string | null;
};
/** GET /api/integration/helpdesk/jobs/assist-retention: the newest runs first. */
export type JobRunsResponse = { job: HelpdeskJob; retentionDays: number; runs: HelpdeskJobRun[] };
/** POST /api/integration/helpdesk/jobs/assist-retention/run (Idempotency-Key): already_running = another instance holds the job. */
export type JobRunResponse = { outcome: "completed" | "already_running"; run: HelpdeskJobRun | null };

/** POST .../run body: { agent: { id, name } }, the staff member BackOffice checked (role-gated and audited there). */
export function parseJobRunInput(value: unknown): { agent: AgentIdentity } {
  return { agent: agentIdentity(record(value)) };
}
