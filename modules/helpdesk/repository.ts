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
  event: EventRecord;
};

export type TicketChange = {
  /** The full row after the change; its sequence must equal expectedSequence + 1. */
  ticket: TicketRecord;
  expectedSequence: number;
  message?: MessageRecord;
  attachments: AttachmentRecord[];
  event: EventRecord;
};

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
  listTickets(query: AgentListQuery): Promise<{ tickets: TicketRecord[]; counts: TicketCounts }>;
  listAutoConfirmDue(nowIso: string, userId?: string): Promise<TicketRecord[]>;
  findAttachment(id: string): Promise<AttachmentRecord | null>;
};
