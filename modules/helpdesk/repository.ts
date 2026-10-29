// Storage port for Helpdesk tickets. Implementations live in
// repositories/helpdeskRepository.ts (PostgreSQL, and a DEV-only local file
// fallback). Every write is atomic: the ticket row, the optional message and
// attachments, and exactly one event commit together or not at all.
import type { AgentListQuery, AssistFeedback, AssistSource, AssistVia, ChatEndReason, FaqNodeType, HelpdeskAlternative, HelpdeskLocale, SituationSignal, SuggestIntent, SuggestKind, TicketCounts } from "@/contracts/helpdesk";
import type { AttachmentRecord, EventRecord, MessageRecord, TicketAggregate, TicketRecord } from "./domain";

export type IdempotencyRecord = { ticketId: string; payloadHash: string };

export type NewTicket = {
  /** number is assigned by the repository from the per-day counter. */
  ticket: Omit<TicketRecord, "number">;
  message: MessageRecord;
  attachments: AttachmentRecord[];
  /** created (sequence 1), then suggestion_declined (sequence 2) when the learner declined an AI suggestion. */
  events: EventRecord[];
  /**
   * v2 §4a: link these helpdesk_assist_log rows to the new ticket in the same
   * transaction — only rows of learnerId, created after sinceIso and not yet
   * linked; any other id is skipped silently. declinedId (the submit-time
   * suggestion the learner declined by submitting) also gets feedback
   * 'declined' when it is one of those rows, from source submit, with no
   * feedback yet (first wins). v5: the open chat sessions of the linked rows
   * end with reason ticket.
   */
  assistLinks?: { ids: string[]; learnerId: string; sinceIso: string; declinedId?: string | null };
};

/** One AI Support Assistant answer as shown to the learner (helpdesk_assist_log, v2 §4a). */
export type AssistRecord = {
  /** The run id Portal sent Admin (a UUIDv7); Admin answers with it as the suggestion id. */
  id: string;
  learnerId: string;
  source: AssistSource;
  locale: HelpdeskLocale;
  /** What the learner typed (chat), the chip question, or the enquiry subject (submit); at most 500 code points. */
  question: string;
  faqId: string | null;
  faqQuestion: string | null;
  /** The verbatim answer shown, or null for the fallback. */
  answer: string | null;
  feedback: AssistFeedback | null;
  ticketId: string | null;
  /** Idempotency-Key of the chat request (null for submit checks). */
  clientEventId: string | null;
  payloadHash: string | null;
  createdAt: string;
  /** When Admin confirmed the feedback (null: not yet told; the sweep retries). */
  feedbackDeliveredAt: string | null;
  /** The last attempt to tell Admin (the sweep tries the least recently tried first). */
  feedbackAttemptedAt: string | null;
  /** v3 §1: the "You might be asking" questions shown with a missing answer ([] when none), so a replay shows the same. */
  alternatives: HelpdeskAlternative[];
} & Partial<AssistTurnColumns>;

/**
 * v5 (migration 023, spec Part G1 and graph design §3): the turn's place in the chat session and what it was, enum
 * names only. Left out (or null) on rows written before v5 and on submit-time checks.
 */
export type AssistTurnColumns = {
  sessionId: string | null;
  /** 1, 2, 3 ... within the session, assigned when the row is recorded. */
  turnIndex: number | null;
  /** The node shown this turn (the answer, the choice node, or the card a clarify explained). */
  nodeId: string | null;
  /** The node on screen before it (the card a follow-up or option was clicked on). */
  parentNodeId: string | null;
  via: AssistVia | null;
  kind: SuggestKind | "handover" | null;
  intent: SuggestIntent | null;
  /** "passed", "fallback" or a guard reason code (Admin's, or Portal's own check when it refused a string). */
  guard: string | null;
  releaseVersion: number | null;
  traceId: string | null;
  /** The session's situation signals (enum names) when the turn was shown. */
  signals: SituationSignal[] | null;
  /** The excerpt's block ids shown ([] or null = the whole answer). */
  blocks: string[] | null;
  /** The learner opened "show the full answer". */
  expanded: boolean | null;
  /** clarify: whether the card covered the follow-up. */
  covered: boolean | null;
  /** The short strings shown with the card (so an Idempotency-Key replay shows the same) and the node type. */
  texts: AssistTexts | null;
};

export type AssistTexts = { opening: string | null; closing: string | null; reply: string | null; explanation: string | null; nodeType: FaqNodeType | null };

/**
 * v5: a click answered from the cached release (never sent to Admin): its feedback stays in Portal, so the
 * outcome sweep never forwards it (Admin would not know the run). Typed turns and chips asked through Admin's
 * per-FAQ path (no release version on the row) are Admin's runs.
 */
export function answeredByPortal(row: Pick<AssistRecord, "via" | "releaseVersion">): boolean {
  return Boolean(row.via && row.via !== "typed" && row.releaseVersion);
}

/** v5 (graph design §3): one chat session of the learner (helpdesk_chat_sessions); Portal is its only writer. */
export type ChatSessionRecord = {
  id: string;
  learnerId: string;
  locale: HelpdeskLocale;
  releaseVersion: number | null;
  startedAt: string;
  lastTurnAt: string;
  endedAt: string | null;
  endReason: ChatEndReason | null;
  turns: number;
  unsolvedStreak: number;
  /** The card on screen (the last node shown). */
  currentNodeId: string | null;
  signals: SituationSignal[];
};

/** How a recorded turn changes the session's unsolved streak (v4 rules: smalltalk keeps it, an answer resets it). */
export type TurnUpdate = { unsolved: "reset" | "increment" | "keep"; currentNodeId?: string | null };

/** v3 §2: the learner's rating of one answer they were shown (helpdesk_ai_ratings); runId is the assist log row. */
export type AiRatingRecord = { runId: string; learnerId: string; source: AssistSource; rating: number; createdAt: string };

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
   * The learner posted a public message or said "Not yet": set unread_by_agent. The stored flag
   * is only ever raised here and only cleared by markRead (which, given the
   * agent's seen sequence, skips a ticket that moved on), so a stale snapshot
   * can never undo an agent's mark_read or a learner's new message.
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
  /**
   * Clears unread_by_agent; not an event, never changes the sequence. With
   * seenSequence (the sequence the agent's snapshot showed) it clears only
   * while the ticket is still at or below it, so a learner message that
   * arrived after that snapshot keeps its unread dot.
   */
  markRead(ticketId: string, seenSequence: number | null): Promise<void>;
  listAutoConfirmDue(nowIso: string, userId?: string): Promise<TicketRecord[]>;
  /**
   * Rate limiting: createdAt of the n-th newest ticket this learner created
   * after sinceIso, or null when there are fewer than n. Once that ticket is
   * an hour old the learner is under the limit again.
   */
  nthRecentTicketAt(userId: string, sinceIso: string, n: number): Promise<string | null>;
  /** Rate limiting: the same for public messages this learner wrote on their own tickets (a ticket's first message included). */
  nthRecentLearnerMessageAt(userId: string, sinceIso: string, n: number): Promise<string | null>;
  findAttachment(id: string): Promise<AttachmentRecord | null>;
  // ---- v2 §4a AI assist log
  /** "duplicate" when the id or the Idempotency-Key is already stored. */
  insertAssist(record: AssistRecord): Promise<"inserted" | "duplicate">;
  findAssist(id: string): Promise<AssistRecord | null>;
  findAssistByKey(clientEventId: string): Promise<AssistRecord | null>;
  /** Sets feedback only while it is null and the row belongs to learnerId; returns the row as stored afterwards (null: no such row for this learner). */
  setAssistFeedback(id: string, learnerId: string, feedback: AssistFeedback): Promise<AssistRecord | null>;
  /** Rate limiting: createdAt of the n-th newest row of this learner from these sources after sinceIso, or null. */
  nthRecentAssistAt(learnerId: string, sinceIso: string, n: number, sources: readonly AssistSource[]): Promise<string | null>;
  /** Records one attempt to forward the row's feedback to Admin; delivered sets feedbackDeliveredAt. */
  recordAssistDelivery(id: string, atIso: string, delivered: boolean): Promise<void>;
  /** The learner's current conversation: id of their oldest row after sinceIso not yet linked to a ticket (Admin's parentRunId), or null. */
  conversationRootAssist(learnerId: string, sinceIso: string): Promise<string | null>;
  /** v3: the FAQs that conversation already showed: distinct faqIds of the learner's answered rows after sinceIso not yet linked to a ticket, newest first, at most limit (Admin's shownFaqIds). */
  conversationShownFaqIds(learnerId: string, sinceIso: string, limit: number): Promise<string[]>;
  /** Rows with feedback Admin has not confirmed, created after sinceIso: never tried first, then least recently tried, then oldest. */
  listUndeliveredAssists(sinceIso: string, limit: number): Promise<AssistRecord[]>;
  /** Rows linked to a ticket, oldest first, each with the learner's rating (v3 §2) or null. */
  listAssistsByTicket(ticketId: string): Promise<Array<AssistRecord & { rating: number | null }>>;
  // ---- v3 §2 AI service rating
  /** Stores the rating unless that run already has one (first wins); returns the rating stored afterwards. */
  insertAiRating(record: AiRatingRecord): Promise<number>;
  findAiRating(runId: string): Promise<number | null>;
  // ---- v5 chat sessions (migration 023)
  createChatSession(record: ChatSessionRecord): Promise<void>;
  findChatSession(id: string): Promise<ChatSessionRecord | null>;
  /**
   * Records one turn of a session (record.sessionId) atomically: the row gets the next turn index, and the session its
   * turn count, last turn time, unsolved streak and card on screen. "duplicate" (nothing changed) when the id or the
   * Idempotency-Key is already stored; "no_session" when the session does not exist or belongs to someone else.
   */
  recordTurn(record: AssistRecord, update: TurnUpdate): Promise<{ status: "inserted"; turnIndex: number } | { status: "duplicate" } | { status: "no_session" }>;
  /** The first end wins; returns the session as stored afterwards (null: no such session of this learner). */
  endChatSession(id: string, learnerId: string, reason: ChatEndReason, atIso: string): Promise<ChatSessionRecord | null>;
  /**
   * The learner's newest session in this locale that is still open, has no turns and was started at or after sinceIso
   * (null: none). Starting the chat again while that one is unused hands it out again instead of a new row per call.
   */
  openEmptyChatSession(learnerId: string, locale: HelpdeskLocale, sinceIso: string): Promise<ChatSessionRecord | null>;
  /** Whether one of these sessions of this learner already showed this card (graph design §4: a step is clicked on a card the chat showed). */
  sessionShowedNode(sessionIds: readonly string[], learnerId: string, nodeId: string): Promise<boolean>;
  /** What the learner typed in this session (via typed), oldest first, the newest limit. */
  sessionLearnerTurns(sessionId: string, limit: number): Promise<string[]>;
  /** Marks that the learner opened the full answer of their own row; returns the row (null: not theirs). */
  setAssistExpanded(id: string, learnerId: string): Promise<AssistRecord | null>;
};
