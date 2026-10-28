// Storage port for Helpdesk tickets. Implementations live in
// repositories/helpdeskRepository.ts (PostgreSQL, and a DEV-only local file
// fallback). Every write is atomic: the ticket row, the optional message and
// attachments, and exactly one event commit together or not at all.
import type { AgentListQuery, TicketCounts } from "@/contracts/helpdesk";
import type { AttachmentRecord, EventRecord, MessageRecord, TicketAggregate, TicketRecord } from "./domain";

export type IdempotencyRecord = { ticketId: string; payloadHash: string };

export type NewTicket = {
  /** number is assigned by the repository from the per-day counter. */
  ticket: Omit<TicketRecord, "number">;
  message: MessageRecord;
  attachments: AttachmentRecord[];
  /** created (sequence 1), then suggestion_declined (sequence 2) when the learner declined an AI suggestion. */
  events: EventRecord[];
};

export type TicketChange = {
  /** The full row after the change; its sequence must equal expectedSequence + 1. */
  ticket: TicketRecord;
  expectedSequence: number;
  message?: MessageRecord;
  attachments: AttachmentRecord[];
  event: EventRecord;
  /** A tag change that commits with the event (add_tag / remove_tag). */
  tag?: { op: "add" | "remove"; tag: string; at: string };
  /**
   * The learner posted a public message: set unread_by_agent. The stored flag
   * is only ever raised here and only cleared by markRead, so a stale row
   * snapshot can never undo an agent's mark_read or a learner's new message.
   */
  markUnread?: boolean;
};

/** A list row: the ticket plus its one-line preview source and tags. */
export type TicketListItem = TicketRecord & { firstMessage: string; tags: string[] };

export type HelpdeskRepository = {
  findTicket(id: string): Promise<TicketAggregate | null>;
  /** Idempotency lookup for ticket creation (helpdesk_tickets.client_event_id). */
  findTicketByKey(clientEventId: string): Promise<IdempotencyRecord | null>;
  /** Idempotency lookup for commands on an existing ticket (helpdesk_ticket_events.client_event_id). */
  findCommandByKey(clientEventId: string): Promise<IdempotencyRecord | null>;
  insertTicket(input: NewTicket): Promise<{ status: "created"; number: string } | { status: "duplicate" }>;
  /** Optimistic concurrency: "stale" when the stored sequence is no longer expectedSequence. */
  appendChange(input: TicketChange): Promise<"applied" | "stale" | "duplicate">;
  listTicketsByUser(userId: string): Promise<TicketRecord[]>;
  /** Newest activity first (updated_at DESC, id DESC); returns at most limit + 1 rows so the caller can tell whether more exist. */
  listTickets(query: AgentListQuery): Promise<{ tickets: TicketListItem[]; counts: TicketCounts }>;
  countTicketsByUser(userId: string): Promise<number>;
  /** Clears unread_by_agent; not an event, never changes the sequence. */
  markRead(ticketId: string): Promise<void>;
  listAutoConfirmDue(nowIso: string, userId?: string): Promise<TicketRecord[]>;
  findAttachment(id: string): Promise<AttachmentRecord | null>;
};
