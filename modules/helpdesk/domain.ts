// Helpdesk ticket domain: records, the ONE transition table, windows and
// numbering. Pure functions only — no storage, no clock reads.
import type {
  AuthorKind,
  CloseReason,
  HelpdeskAttachmentType,
  HelpdeskEventData,
  HelpdeskEventName,
  HelpdeskLocale,
  TicketCategory,
  TicketStatus
} from "@/contracts/helpdesk";

export const CONFIRM_WINDOW_HOURS = 72;
export const REOPEN_WINDOW_DAYS = 7;
export const EVENT_TYPE_PREFIX = "com.ilovelearningguide.helpdesk.ticket.";
export const EVENT_SOURCE = "/portal/helpdesk";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type ActorKind = "learner" | "agent" | "system";
export type Actor = { kind: ActorKind; id: string | null; name: string | null };

export type TicketRecord = {
  id: string;
  number: string;
  userId: string;
  userEmail: string;
  userName: string;
  locale: HelpdeskLocale;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  sequence: number;
  confirmDueAt: string | null;
  closedAt: string | null;
  closeReason: CloseReason | null;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessageBy: AuthorKind;
  clientEventId: string;
  payloadHash: string;
};

export type MessageRecord = {
  id: string;
  ticketId: string;
  authorKind: AuthorKind;
  authorId: string | null;
  authorName: string | null;
  body: string;
  internal: boolean;
  attachmentIds: string[];
  clientEventId: string | null;
  payloadHash: string | null;
  createdAt: string;
};

export type AttachmentRecord = {
  id: string;
  ticketId: string;
  messageId: string;
  uploaderKind: "learner" | "agent";
  fileName: string;
  contentType: HelpdeskAttachmentType;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
};

export type EventRecord = {
  id: string;
  specversion: "1.0";
  source: typeof EVENT_SOURCE;
  type: string;
  subject: string;
  time: string;
  datacontenttype: "application/json";
  data: HelpdeskEventData;
  sequence: number;
  clientEventId: string | null;
  payloadHash: string | null;
};

export type TicketAggregate = { ticket: TicketRecord; messages: MessageRecord[]; attachments: AttachmentRecord[]; events: EventRecord[] };

export type Command =
  | "create" | "cancel" | "claim" | "agent_reply" | "internal_note" | "learner_reply" | "propose_resolution"
  | "confirm" | "reject" | "close" | "rate" | "auto_confirm";

type Guard = "reopen_window" | "rating" | "confirm_due";

export type Transition = Readonly<{
  command: Command;
  actor: ActorKind;
  from: readonly (TicketStatus | null)[];
  to: TicketStatus | "unchanged";
  event: HelpdeskEventName;
  closeReason?: CloseReason;
  guard?: Guard;
}>;

const NON_TERMINAL = ["OPEN", "ASSIGNED", "WAITING_USER", "PENDING_CONFIRM"] as const;

/** Spec §2. Anything not listed here is rejected (409 invalid_transition). */
export const TRANSITIONS: readonly Transition[] = [
  { command: "create", actor: "learner", from: [null], to: "OPEN", event: "created" },
  { command: "cancel", actor: "learner", from: ["OPEN"], to: "CANCELLED", event: "cancelled", closeReason: "cancelled" },
  { command: "claim", actor: "agent", from: ["OPEN"], to: "ASSIGNED", event: "claimed" },
  { command: "agent_reply", actor: "agent", from: ["OPEN", "ASSIGNED", "WAITING_USER"], to: "WAITING_USER", event: "agent_replied" },
  { command: "internal_note", actor: "agent", from: [...NON_TERMINAL, "CLOSED"], to: "unchanged", event: "internal_note_added" },
  { command: "learner_reply", actor: "learner", from: ["WAITING_USER"], to: "ASSIGNED", event: "learner_replied" },
  { command: "learner_reply", actor: "learner", from: ["OPEN", "ASSIGNED"], to: "unchanged", event: "learner_replied" },
  { command: "learner_reply", actor: "learner", from: ["PENDING_CONFIRM"], to: "ASSIGNED", event: "learner_replied" },
  { command: "learner_reply", actor: "learner", from: ["CLOSED"], to: "ASSIGNED", event: "reopened", guard: "reopen_window" },
  { command: "propose_resolution", actor: "agent", from: ["ASSIGNED", "WAITING_USER"], to: "PENDING_CONFIRM", event: "resolution_proposed" },
  { command: "confirm", actor: "learner", from: ["PENDING_CONFIRM"], to: "CLOSED", event: "confirmed", closeReason: "user_confirmed" },
  { command: "reject", actor: "learner", from: ["PENDING_CONFIRM"], to: "ASSIGNED", event: "resolution_rejected" },
  { command: "close", actor: "learner", from: ["ASSIGNED", "WAITING_USER"], to: "CLOSED", event: "closed_by_learner", closeReason: "user_closed" },
  { command: "auto_confirm", actor: "system", from: ["PENDING_CONFIRM"], to: "CLOSED", event: "auto_confirmed", closeReason: "auto_confirmed", guard: "confirm_due" },
  { command: "rate", actor: "learner", from: ["CLOSED"], to: "unchanged", event: "rated", guard: "rating" }
];

export type TicketState = Pick<TicketRecord, "status" | "assigneeId" | "confirmDueAt" | "closedAt" | "rating">;
export type RejectionCode = "invalid_transition" | "reopen_window_passed" | "rating_window_passed" | "already_rated";
export type Decision = { ok: true; transition: Transition; to: TicketStatus } | { ok: false; code: RejectionCode };

export function reopenDeadline(closedAt: string): string {
  return new Date(Date.parse(closedAt) + REOPEN_WINDOW_DAYS * DAY_MS).toISOString();
}

export function confirmDueAt(now: Date): string {
  return new Date(now.getTime() + CONFIRM_WINDOW_HOURS * HOUR_MS).toISOString();
}

function withinFollowUpWindow(state: TicketState, now: Date) {
  return Boolean(state.closedAt) && now.getTime() <= Date.parse(reopenDeadline(state.closedAt as string));
}

function guardFailure(guard: Guard | undefined, state: TicketState, now: Date): RejectionCode | null {
  if (guard === "reopen_window") return withinFollowUpWindow(state, now) ? null : "reopen_window_passed";
  if (guard === "rating") {
    if (state.rating !== null) return "already_rated";
    return withinFollowUpWindow(state, now) ? null : "rating_window_passed";
  }
  if (guard === "confirm_due") return state.confirmDueAt && Date.parse(state.confirmDueAt) <= now.getTime() ? null : "invalid_transition";
  return null;
}

export function decide(state: TicketState | null, command: Command, actor: ActorKind, now: Date): Decision {
  const from = state ? state.status : null;
  const row = TRANSITIONS.find((item) => item.command === command && item.actor === actor && item.from.includes(from));
  if (!row) return { ok: false, code: "invalid_transition" };
  const failure = guardFailure(row.guard, state as TicketState, now);
  if (failure) return { ok: false, code: failure };
  const to = row.to === "unchanged" ? (from as TicketStatus) : row.to;
  return { ok: true, transition: row, to };
}

export function eventType(name: HelpdeskEventName) {
  return `${EVENT_TYPE_PREFIX}${name}`;
}

/** Agent queue rule: a learner is waiting on support. */
export function needsReply(ticket: Pick<TicketRecord, "status" | "lastMessageBy">) {
  return (ticket.status === "OPEN" || ticket.status === "ASSIGNED") && ticket.lastMessageBy === "learner";
}

export function isAutoConfirmDue(ticket: Pick<TicketRecord, "status" | "confirmDueAt">, now: Date) {
  return ticket.status === "PENDING_CONFIRM" && Boolean(ticket.confirmDueAt) && Date.parse(ticket.confirmDueAt as string) <= now.getTime();
}

export function followUpUntil(ticket: Pick<TicketRecord, "status" | "closedAt">, now: Date): string | null {
  if (ticket.status !== "CLOSED" || !ticket.closedAt) return null;
  const deadline = reopenDeadline(ticket.closedAt);
  return now.getTime() <= Date.parse(deadline) ? deadline : null;
}

/** UTC day key YYMMDD used by the per-day ticket counter. */
export function ticketDayKey(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
}

export function formatTicketNumber(createdAt: string, counter: number): string {
  return `LG-${ticketDayKey(new Date(createdAt))}-${String(counter).padStart(4, "0")}`;
}

/**
 * The ticket row after an allowed transition. `publicMessage` is set when the
 * command adds a learner-visible message (it moves last_message_*);
 * internal notes only advance the sequence.
 */
export function evolve(ticket: TicketRecord, decision: Extract<Decision, { ok: true }>, context: { now: Date; actor: Actor; publicMessage: boolean; rating?: number }): TicketRecord {
  const { transition, to } = decision;
  const at = context.now.toISOString();
  const next: TicketRecord = { ...ticket, status: to, sequence: ticket.sequence + 1 };
  if (transition.event !== "internal_note_added") next.updatedAt = at;
  if (context.publicMessage) { next.lastMessageAt = at; next.lastMessageBy = context.actor.kind; }
  if (context.actor.kind === "agent" && !next.assigneeId && (transition.command === "claim" || transition.command === "agent_reply" || transition.command === "propose_resolution")) {
    next.assigneeId = context.actor.id;
    next.assigneeName = context.actor.name;
  }
  if (transition.event === "resolution_proposed") next.confirmDueAt = confirmDueAt(context.now);
  else if (to !== "PENDING_CONFIRM") next.confirmDueAt = null;
  if (transition.closeReason) {
    next.closeReason = transition.closeReason;
    next.closedAt = transition.closeReason === "auto_confirmed" ? ticket.confirmDueAt : at;
  }
  if (transition.event === "reopened") { next.closedAt = null; next.closeReason = null; }
  if (transition.event === "rated") next.rating = context.rating ?? null;
  return next;
}
