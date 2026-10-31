// Helpdesk ticket storage. PostgreSQL (migration 017) wherever persistence is
// configured; a DEV-only single-process local file fallback when
// STORAGE_BACKEND is local, mirroring repositories/contactRequestRepository.ts.
// Production never falls back: without PostgreSQL it fails closed.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient, QueryResultRow } from "pg";
import { HelpdeskProblem, TICKET_STATUSES, type AgentListQuery, type TicketCounts } from "@/contracts/helpdesk";
import type { AttachmentRecord, EventRecord, MessageRecord, TagRecord, TicketAggregate, TicketRecord } from "@/modules/helpdesk/domain";
import { formatTicketNumber, needsReply, ticketDayKey } from "@/modules/helpdesk/domain";
import type { AssistRecord, HelpdeskRepository, IdempotencyRecord, NewTicket, TicketChange, TicketListItem } from "@/modules/helpdesk/repository";
import { ensureSchema, getPool } from "@/services/persistence/db";
import { persistenceEnabled } from "@/services/persistence/config";
import { isProductionEnvironment } from "@/services/runtimeConfig";
import { systemRoot } from "@/services/fileStore";

const LEARNER_LIST_MAX = 200;
/** Enough of the first message for a 120-character one-line preview after whitespace is collapsed. */
const PREVIEW_SOURCE_CHARS = 600;
const AUTO_CONFIRM_BATCH = 100;

export function helpdeskRepository(): HelpdeskRepository {
  if (persistenceEnabled()) return createPostgresHelpdeskRepository();
  const backend = (process.env.STORAGE_BACKEND || "").trim().toLowerCase();
  if (!isProductionEnvironment() && ["local", "fs", "filesystem"].includes(backend)) return createLocalHelpdeskRepository(path.join(systemRoot(), "helpdesk"));
  throw new HelpdeskProblem("helpdesk_unavailable");
}

function emptyCounts(): TicketCounts {
  return { OPEN: 0, ASSIGNED: 0, WAITING_USER: 0, PENDING_CONFIRM: 0, CLOSED: 0, CANCELLED: 0, needs_reply: 0, all: 0 };
}

/** Search: ticket number, learner name, account email, contact email or subject (case-insensitive, literal). */
function matchesQuery(ticket: TicketRecord, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [ticket.number, ticket.userName, ticket.userEmail, ticket.contactEmail, ticket.subject].some((value) => value.toLowerCase().includes(needle));
}

/** v2 §4a list filters that also bound the counts: flagged only, one learner. */
function matchesV2Filters(ticket: TicketRecord, query: AgentListQuery) {
  if (query.flagged && !ticket.flaggedAt) return false;
  if (query.learnerId && ticket.userId !== query.learnerId) return false;
  return true;
}

function matchesStatus(ticket: TicketRecord, status: AgentListQuery["status"]) {
  if (!status) return true;
  if (status === "needs_reply") return needsReply(ticket);
  return ticket.status === status;
}

/** createdAt of the n-th newest item after sinceIso, or null when there are fewer than n. */
function nthNewest(createdAts: string[], sinceIso: string, n: number): string | null {
  const recent = createdAts.filter((value) => value > sinceIso).sort().reverse();
  return recent.length >= n ? recent[n - 1] : null;
}

function byActivity(a: TicketRecord, b: TicketRecord) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// ------------------------------------------------------------ local (DEV)

type LocalStore = {
  tickets: TicketRecord[];
  messages: MessageRecord[];
  attachments: AttachmentRecord[];
  events: EventRecord[];
  tags: TagRecord[];
  counters: Record<string, number>;
  assists: AssistRecord[];
};

function tagsOf(store: LocalStore, ticketId: string) {
  return store.tags.filter((item) => item.ticketId === ticketId).sort((a, b) => (a.createdAt === b.createdAt ? (a.tag < b.tag ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)).map((item) => item.tag);
}

const localLocks = new Map<string, Promise<unknown>>();

export function createLocalHelpdeskRepository(root: string): HelpdeskRepository {
  const file = path.join(root, "store.json");

  async function load(): Promise<LocalStore> {
    try {
      const store = JSON.parse(await readFile(file, "utf8")) as LocalStore;
      // DEV files written before the Figma addendum.
      store.tags ||= [];
      // ... and before v2.
      store.assists ||= [];
      for (const row of store.assists) {
        row.feedbackDeliveredAt ??= null;
        row.feedbackAttemptedAt ??= null;
      }
      for (const ticket of store.tickets) {
        ticket.contactEmail ??= ticket.userEmail;
        ticket.suggestionId ??= null;
        ticket.unreadByAgent ??= false;
        ticket.flaggedAt ??= null;
        ticket.flaggedBy ??= null;
      }
      return store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { tickets: [], messages: [], attachments: [], events: [], tags: [], counters: {}, assists: [] };
    }
  }

  async function save(store: LocalStore) {
    await mkdir(root, { recursive: true });
    const temporary = path.join(root, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(store), { mode: 0o600 });
    await rename(temporary, file);
  }

  // One writer at a time per store file within this process (DEV only).
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = localLocks.get(file) ?? Promise.resolve();
    const next = previous.then(work, work);
    localLocks.set(file, next.catch(() => undefined));
    return next;
  }

  function keyIn(store: LocalStore, clientEventId: string): IdempotencyRecord | null {
    const event = store.events.find((item) => item.clientEventId === clientEventId);
    if (event) return { ticketId: event.subject, payloadHash: event.payloadHash as string };
    const ticket = store.tickets.find((item) => item.clientEventId === clientEventId);
    return ticket ? { ticketId: ticket.id, payloadHash: ticket.payloadHash } : null;
  }

  function usedKey(store: LocalStore, clientEventId: string | null) {
    if (!clientEventId) return false;
    return store.tickets.some((item) => item.clientEventId === clientEventId)
      || store.messages.some((item) => item.clientEventId === clientEventId)
      || store.events.some((item) => item.clientEventId === clientEventId);
  }

  return {
    async findTicket(id) {
      const store = await load();
      const ticket = store.tickets.find((item) => item.id === id);
      if (!ticket) return null;
      return {
        ticket,
        messages: store.messages.filter((item) => item.ticketId === id),
        attachments: store.attachments.filter((item) => item.ticketId === id),
        events: store.events.filter((item) => item.subject === id).sort((a, b) => a.sequence - b.sequence),
        tags: tagsOf(store, id)
      };
    },
    async findTicketByKey(clientEventId) {
      const ticket = (await load()).tickets.find((item) => item.clientEventId === clientEventId);
      return ticket ? { ticketId: ticket.id, payloadHash: ticket.payloadHash } : null;
    },
    async findCommandByKey(clientEventId) {
      return keyIn(await load(), clientEventId);
    },
    insertTicket(input: NewTicket) {
      return exclusive(async () => {
        const store = await load();
        if (usedKey(store, input.ticket.clientEventId)) return { status: "duplicate" as const };
        const day = ticketDayKey(new Date(input.ticket.createdAt));
        const counter = (store.counters[day] ?? 0) + 1;
        const number = formatTicketNumber(input.ticket.createdAt, counter);
        store.counters[day] = counter;
        store.tickets.push({ ...input.ticket, number });
        store.messages.push(input.message);
        store.attachments.push(...input.attachments);
        store.events.push(...input.events);
        const links = input.assistLinks;
        if (links) {
          for (const row of store.assists) {
            if (links.ids.includes(row.id) && row.learnerId === links.learnerId && row.createdAt > links.sinceIso && row.ticketId === null) {
              row.ticketId = input.ticket.id;
              if (row.id === links.declinedId && row.source === "submit" && row.feedback === null) row.feedback = "declined";
            }
          }
        }
        await save(store);
        return { status: "created" as const, number };
      });
    },
    appendChange(input: TicketChange) {
      return exclusive(async () => {
        const store = await load();
        const index = store.tickets.findIndex((item) => item.id === input.ticket.id);
        if (index < 0 || store.tickets[index].sequence !== input.expectedSequence) return "stale" as const;
        if (usedKey(store, input.event.clientEventId) || (input.message && usedKey(store, input.message.clientEventId))) return "duplicate" as const;
        store.tickets[index] = { ...input.ticket, unreadByAgent: store.tickets[index].unreadByAgent || Boolean(input.markUnread) };
        if (input.tag?.op === "add" && !store.tags.some((item) => item.ticketId === input.ticket.id && item.tag === input.tag?.tag)) store.tags.push({ ticketId: input.ticket.id, tag: input.tag.tag, createdAt: input.tag.at });
        if (input.tag?.op === "remove") store.tags = store.tags.filter((item) => !(item.ticketId === input.ticket.id && item.tag === input.tag?.tag));
        if (input.message) store.messages.push(input.message);
        store.attachments.push(...input.attachments);
        store.events.push(input.event);
        await save(store);
        return "applied" as const;
      });
    },
    async listTicketsByUser(userId) {
      return (await load()).tickets.filter((item) => item.userId === userId).sort(byActivity).slice(0, LEARNER_LIST_MAX);
    },
    async listTickets(query) {
      const store = await load();
      const searched = store.tickets
        .filter((item) => matchesQuery(item, query.q))
        .filter((item) => !query.category || item.category === query.category)
        .filter((item) => !query.tag || store.tags.some((tag) => tag.ticketId === item.id && tag.tag === query.tag))
        .filter((item) => matchesV2Filters(item, query));
      const counts = emptyCounts();
      for (const ticket of searched) {
        counts[ticket.status] += 1;
        counts.all += 1;
        if (needsReply(ticket)) counts.needs_reply += 1;
      }
      const cursor = query.cursor;
      const tickets = searched
        .filter((item) => matchesStatus(item, query.status))
        .filter((item) => !cursor || item.updatedAt < cursor.updatedAt || (item.updatedAt === cursor.updatedAt && item.id < cursor.id))
        .sort(byActivity)
        .slice(0, query.limit + 1)
        .map((ticket): TicketListItem => {
          const first = store.messages.filter((item) => item.ticketId === ticket.id).sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1))[0];
          return { ...ticket, firstMessage: (first?.body ?? "").slice(0, PREVIEW_SOURCE_CHARS), tags: tagsOf(store, ticket.id) };
        });
      return { tickets, counts };
    },
    async countTicketsByUser(userId) {
      return (await load()).tickets.filter((item) => item.userId === userId).length;
    },
    markRead(ticketId, seenSequence) {
      return exclusive(async () => {
        const store = await load();
        const ticket = store.tickets.find((item) => item.id === ticketId);
        if (!ticket || !ticket.unreadByAgent) return;
        // Only learner activity after the agent's snapshot keeps the dot; agent-only events (tags, flags, notes) do not.
        if (seenSequence !== null && store.events.some((event) => event.subject === ticketId && event.sequence > seenSequence && event.data.actor?.kind === "learner")) return;
        ticket.unreadByAgent = false;
        await save(store);
      });
    },
    async listAutoConfirmDue(nowIso, userId) {
      return (await load()).tickets
        .filter((item) => item.status === "PENDING_CONFIRM" && item.confirmDueAt && item.confirmDueAt <= nowIso && (!userId || item.userId === userId))
        .slice(0, AUTO_CONFIRM_BATCH);
    },
    async findAttachment(id) {
      return (await load()).attachments.find((item) => item.id === id) ?? null;
    },
    async nthRecentTicketAt(userId, sinceIso, n) {
      return nthNewest((await load()).tickets.filter((item) => item.userId === userId).map((item) => item.createdAt), sinceIso, n);
    },
    async nthRecentLearnerMessageAt(userId, sinceIso, n) {
      const store = await load();
      const own = new Set(store.tickets.filter((item) => item.userId === userId).map((item) => item.id));
      return nthNewest(store.messages.filter((item) => item.authorKind === "learner" && own.has(item.ticketId)).map((item) => item.createdAt), sinceIso, n);
    },
    insertAssist(record) {
      return exclusive(async () => {
        const store = await load();
        if (store.assists.some((item) => item.id === record.id || (record.clientEventId !== null && item.clientEventId === record.clientEventId))) return "duplicate" as const;
        store.assists.push(record);
        await save(store);
        return "inserted" as const;
      });
    },
    async findAssist(id) {
      return (await load()).assists.find((item) => item.id === id) ?? null;
    },
    async findAssistByKey(clientEventId) {
      return (await load()).assists.find((item) => item.clientEventId === clientEventId) ?? null;
    },
    setAssistFeedback(id, learnerId, feedback) {
      return exclusive(async () => {
        const store = await load();
        const row = store.assists.find((item) => item.id === id && item.learnerId === learnerId);
        if (!row) return null;
        if (row.feedback === null) { row.feedback = feedback; await save(store); }
        return row;
      });
    },
    async nthRecentAssistAt(learnerId, sinceIso, n, sources) {
      return nthNewest((await load()).assists.filter((item) => item.learnerId === learnerId && sources.includes(item.source)).map((item) => item.createdAt), sinceIso, n);
    },
    async conversationRootAssist(learnerId, sinceIso) {
      const open = (await load()).assists.filter((item) => item.learnerId === learnerId && item.ticketId === null && item.createdAt > sinceIso);
      open.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
      return open[0]?.id ?? null;
    },
    recordAssistDelivery(id, atIso, delivered) {
      return exclusive(async () => {
        const store = await load();
        const row = store.assists.find((item) => item.id === id);
        if (!row) return;
        row.feedbackAttemptedAt = atIso;
        if (delivered) row.feedbackDeliveredAt ??= atIso;
        await save(store);
      });
    },
    async listUndeliveredAssists(sinceIso, limit) {
      const order = (row: AssistRecord) => `${row.feedbackAttemptedAt === null ? "0" : `1${row.feedbackAttemptedAt}`}|${row.createdAt}|${row.id}`;
      return (await load()).assists
        .filter((item) => item.feedback !== null && !item.feedbackDeliveredAt && item.createdAt > sinceIso)
        .sort((a, b) => (order(a) < order(b) ? -1 : 1))
        .slice(0, limit);
    },
    async listAssistsByTicket(ticketId) {
      return (await load()).assists.filter((item) => item.ticketId === ticketId).sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
    }
  };
}

// ------------------------------------------------------------ PostgreSQL

const iso = (value: unknown): string => (value instanceof Date ? value : new Date(String(value))).toISOString();
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));

const TICKET_COLUMNS = `id::text, number, user_id, user_email, user_name, contact_email, locale, category, subject, status, assignee_id, assignee_name,
  sequence, confirm_due_at, closed_at, close_reason, rating, created_at, updated_at, last_message_at, last_message_by,
  client_event_id::text, payload_hash, suggestion_id::text, unread_by_agent, flagged_at, flagged_by`;

function ticketFromRow(row: QueryResultRow): TicketRecord {
  return {
    id: row.id, number: row.number, userId: row.user_id, userEmail: row.user_email, userName: row.user_name, contactEmail: row.contact_email,
    locale: row.locale, category: row.category, subject: row.subject, status: row.status,
    assigneeId: row.assignee_id, assigneeName: row.assignee_name, sequence: Number(row.sequence),
    confirmDueAt: isoOrNull(row.confirm_due_at), closedAt: isoOrNull(row.closed_at), closeReason: row.close_reason,
    rating: row.rating === null ? null : Number(row.rating), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    lastMessageAt: iso(row.last_message_at), lastMessageBy: row.last_message_by, clientEventId: row.client_event_id, payloadHash: row.payload_hash,
    suggestionId: row.suggestion_id ?? null, unreadByAgent: Boolean(row.unread_by_agent),
    flaggedAt: isoOrNull(row.flagged_at), flaggedBy: row.flagged_by ?? null
  };
}

const ASSIST_COLUMNS = "id::text, learner_id, source, locale, question, faq_id::text, faq_question, answer, feedback, ticket_id::text, client_event_id::text, payload_hash, created_at, feedback_delivered_at, feedback_attempted_at";

function assistFromRow(row: QueryResultRow): AssistRecord {
  return {
    id: row.id, learnerId: row.learner_id, source: row.source, locale: row.locale, question: row.question, faqId: row.faq_id ?? null,
    faqQuestion: row.faq_question ?? null, answer: row.answer ?? null, feedback: row.feedback ?? null, ticketId: row.ticket_id ?? null,
    clientEventId: row.client_event_id ?? null, payloadHash: row.payload_hash ?? null, createdAt: iso(row.created_at),
    feedbackDeliveredAt: isoOrNull(row.feedback_delivered_at), feedbackAttemptedAt: isoOrNull(row.feedback_attempted_at)
  };
}

function messageFromRow(row: QueryResultRow): MessageRecord {
  return {
    id: row.id, ticketId: row.ticket_id, authorKind: row.author_kind, authorId: row.author_id, authorName: row.author_name,
    body: row.body, internal: row.internal, attachmentIds: row.attachment_ids ?? [], clientEventId: row.client_event_id,
    payloadHash: row.payload_hash, createdAt: iso(row.created_at)
  };
}

function attachmentFromRow(row: QueryResultRow): AttachmentRecord {
  return {
    id: row.id, ticketId: row.ticket_id, messageId: row.message_id, uploaderKind: row.uploader_kind, fileName: row.file_name,
    contentType: row.content_type, sizeBytes: Number(row.size_bytes), storageKey: row.storage_key, createdAt: iso(row.created_at)
  };
}

function eventFromRow(row: QueryResultRow): EventRecord {
  return {
    id: row.id, specversion: row.specversion, source: row.source, type: row.type, subject: row.subject, time: iso(row.time),
    datacontenttype: row.datacontenttype, data: row.data, sequence: Number(row.sequence), clientEventId: row.client_event_id, payloadHash: row.payload_hash
  };
}

const MESSAGE_COLUMNS = "id::text, ticket_id::text, author_kind, author_id, author_name, body, internal, attachment_ids::text[] AS attachment_ids, client_event_id::text, payload_hash, created_at";
const ATTACHMENT_COLUMNS = "id::text, ticket_id::text, message_id::text, uploader_kind, file_name, content_type, size_bytes, storage_key, created_at";
const EVENT_COLUMNS = "id::text, specversion, source, type, subject::text, time, datacontenttype, data, sequence, client_event_id::text, payload_hash";

async function insertMessage(client: PoolClient, message: MessageRecord) {
  await client.query(`INSERT INTO helpdesk_ticket_messages (id, ticket_id, author_kind, author_id, author_name, body, internal, attachment_ids, client_event_id, payload_hash, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9,$10,$11)`,
  [message.id, message.ticketId, message.authorKind, message.authorId, message.authorName, message.body, message.internal, message.attachmentIds, message.clientEventId, message.payloadHash, message.createdAt]);
}

async function insertAttachments(client: PoolClient, attachments: AttachmentRecord[]) {
  for (const item of attachments) {
    await client.query(`INSERT INTO helpdesk_attachments (id, ticket_id, message_id, uploader_kind, file_name, content_type, size_bytes, storage_key, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [item.id, item.ticketId, item.messageId, item.uploaderKind, item.fileName, item.contentType, item.sizeBytes, item.storageKey, item.createdAt]);
  }
}

async function insertEvent(client: PoolClient, event: EventRecord) {
  await client.query(`INSERT INTO helpdesk_ticket_events (id, specversion, source, type, subject, time, datacontenttype, data, sequence, client_event_id, payload_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
  [event.id, event.specversion, event.source, event.type, event.subject, event.time, event.datacontenttype, JSON.stringify(event.data), event.sequence, event.clientEventId, event.payloadHash]);
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string }).code === "23505";
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>, isolation = ""): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query(`BEGIN${isolation ? ` ${isolation}` : ""}`);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

class Rollback<T> extends Error { constructor(public readonly value: T) { super("rollback"); } }

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function createPostgresHelpdeskRepository(): HelpdeskRepository {
  async function select<T extends QueryResultRow>(text: string, params: unknown[]) {
    await ensureSchema();
    return (await getPool().query<T>(text, params)).rows;
  }

  return {
    async findTicket(id) {
      return inTransaction(async (client) => {
        const ticket = (await client.query(`SELECT ${TICKET_COLUMNS} FROM helpdesk_tickets WHERE id = $1`, [id])).rows[0];
        if (!ticket) return null;
        const [messages, attachments, events, tags] = [
          (await client.query(`SELECT ${MESSAGE_COLUMNS} FROM helpdesk_ticket_messages WHERE ticket_id = $1 ORDER BY created_at, id`, [id])).rows,
          (await client.query(`SELECT ${ATTACHMENT_COLUMNS} FROM helpdesk_attachments WHERE ticket_id = $1 ORDER BY created_at, id`, [id])).rows,
          (await client.query(`SELECT ${EVENT_COLUMNS} FROM helpdesk_ticket_events WHERE subject = $1 ORDER BY sequence`, [id])).rows,
          (await client.query<{ tag: string }>("SELECT tag FROM helpdesk_ticket_tags WHERE ticket_id = $1 ORDER BY created_at, tag", [id])).rows
        ];
        const aggregate: TicketAggregate = { ticket: ticketFromRow(ticket), messages: messages.map(messageFromRow), attachments: attachments.map(attachmentFromRow), events: events.map(eventFromRow), tags: tags.map((row) => row.tag) };
        return aggregate;
      }, "ISOLATION LEVEL REPEATABLE READ READ ONLY");
    },
    async findTicketByKey(clientEventId) {
      const row = (await select<{ id: string; payload_hash: string }>("SELECT id::text, payload_hash FROM helpdesk_tickets WHERE client_event_id = $1", [clientEventId]))[0];
      return row ? { ticketId: row.id, payloadHash: row.payload_hash } : null;
    },
    async findCommandByKey(clientEventId) {
      const row = (await select<{ subject: string; payload_hash: string }>("SELECT subject::text, payload_hash FROM helpdesk_ticket_events WHERE client_event_id = $1", [clientEventId]))[0];
      if (row) return { ticketId: row.subject, payloadHash: row.payload_hash };
      const ticket = (await select<{ id: string; payload_hash: string }>("SELECT id::text, payload_hash FROM helpdesk_tickets WHERE client_event_id = $1", [clientEventId]))[0];
      return ticket ? { ticketId: ticket.id, payloadHash: ticket.payload_hash } : null;
    },
    async insertTicket(input) {
      try {
        return await inTransaction(async (client) => {
          const ticket = input.ticket;
          const counter = (await client.query<{ last: number }>(`INSERT INTO helpdesk_ticket_counters (day, last) VALUES ($1, 1)
            ON CONFLICT (day) DO UPDATE SET last = helpdesk_ticket_counters.last + 1 RETURNING last`, [ticketDayKey(new Date(ticket.createdAt))])).rows[0].last;
          const number = formatTicketNumber(ticket.createdAt, Number(counter));
          const inserted = await client.query(`INSERT INTO helpdesk_tickets (id, number, user_id, user_email, user_name, locale, category, subject, status, assignee_id, assignee_name,
              sequence, confirm_due_at, closed_at, close_reason, rating, created_at, updated_at, last_message_at, last_message_by, client_event_id, payload_hash,
              contact_email, suggestion_id, unread_by_agent, flagged_at, flagged_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
            ON CONFLICT (client_event_id) DO NOTHING RETURNING id`,
          [ticket.id, number, ticket.userId, ticket.userEmail, ticket.userName, ticket.locale, ticket.category, ticket.subject, ticket.status, ticket.assigneeId, ticket.assigneeName,
            ticket.sequence, ticket.confirmDueAt, ticket.closedAt, ticket.closeReason, ticket.rating, ticket.createdAt, ticket.updatedAt, ticket.lastMessageAt, ticket.lastMessageBy, ticket.clientEventId, ticket.payloadHash,
            ticket.contactEmail, ticket.suggestionId, ticket.unreadByAgent, ticket.flaggedAt, ticket.flaggedBy]);
          // A duplicate key must not consume a number: roll the counter back too.
          if (!inserted.rows[0]) throw new Rollback({ status: "duplicate" as const });
          await insertMessage(client, input.message);
          await insertAttachments(client, input.attachments);
          for (const event of input.events) await insertEvent(client, event);
          const links = input.assistLinks;
          if (links && links.ids.length) {
            await client.query(`UPDATE helpdesk_assist_log SET ticket_id = $1
              WHERE id = ANY($2::uuid[]) AND learner_id = $3 AND created_at > $4 AND ticket_id IS NULL`, [ticket.id, links.ids, links.learnerId, links.sinceIso]);
            // Submitting after the modal is the "declined" outcome, recorded with the ticket (first wins).
            if (links.declinedId) {
              await client.query(`UPDATE helpdesk_assist_log SET feedback = 'declined'
                WHERE id = $1::uuid AND ticket_id = $2 AND source = 'submit' AND feedback IS NULL`, [links.declinedId, ticket.id]);
            }
          }
          return { status: "created" as const, number };
        });
      } catch (error) {
        if (error instanceof Rollback) return error.value as { status: "duplicate" };
        if (isUniqueViolation(error)) return { status: "duplicate" };
        throw error;
      }
    },
    async appendChange(input) {
      try {
        return await inTransaction(async (client) => {
          const ticket = input.ticket;
          const updated = await client.query(`UPDATE helpdesk_tickets SET status = $3, assignee_id = $4, assignee_name = $5, sequence = $6, confirm_due_at = $7,
              closed_at = $8, close_reason = $9, rating = $10, updated_at = $11, last_message_at = $12, last_message_by = $13,
              unread_by_agent = unread_by_agent OR $14, flagged_at = $15, flagged_by = $16
            WHERE id = $1 AND sequence = $2`,
          [ticket.id, input.expectedSequence, ticket.status, ticket.assigneeId, ticket.assigneeName, ticket.sequence, ticket.confirmDueAt,
            ticket.closedAt, ticket.closeReason, ticket.rating, ticket.updatedAt, ticket.lastMessageAt, ticket.lastMessageBy, Boolean(input.markUnread),
            ticket.flaggedAt, ticket.flaggedBy]);
          if (updated.rowCount !== 1) throw new Rollback("stale" as const);
          if (input.tag?.op === "add") await client.query("INSERT INTO helpdesk_ticket_tags (ticket_id, tag, created_at) VALUES ($1, $2, $3) ON CONFLICT (ticket_id, tag) DO NOTHING", [ticket.id, input.tag.tag, input.tag.at]);
          if (input.tag?.op === "remove") await client.query("DELETE FROM helpdesk_ticket_tags WHERE ticket_id = $1 AND tag = $2", [ticket.id, input.tag.tag]);
          if (input.message) await insertMessage(client, input.message);
          await insertAttachments(client, input.attachments);
          await insertEvent(client, input.event);
          return "applied" as const;
        });
      } catch (error) {
        if (error instanceof Rollback) return error.value as "stale";
        if (isUniqueViolation(error)) return "duplicate";
        throw error;
      }
    },
    async listTicketsByUser(userId) {
      return (await select(`SELECT ${TICKET_COLUMNS} FROM helpdesk_tickets WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT ${LEARNER_LIST_MAX}`, [userId])).map(ticketFromRow);
    },
    async listTickets(query) {
      const params: unknown[] = [];
      const searchClauses: string[] = [];
      if (query.q) {
        params.push(`%${escapeLike(query.q)}%`);
        const p = `$${params.length}`;
        searchClauses.push(`(number ILIKE ${p} OR user_name ILIKE ${p} OR user_email ILIKE ${p} OR contact_email ILIKE ${p} OR subject ILIKE ${p})`);
      }
      if (query.category) { params.push(query.category); searchClauses.push(`category = $${params.length}`); }
      if (query.tag) { params.push(query.tag); searchClauses.push(`EXISTS (SELECT 1 FROM helpdesk_ticket_tags tags WHERE tags.ticket_id = helpdesk_tickets.id AND tags.tag = $${params.length})`); }
      if (query.flagged) searchClauses.push("flagged_at IS NOT NULL");
      if (query.learnerId) { params.push(query.learnerId); searchClauses.push(`user_id = $${params.length}`); }
      const searchWhere = searchClauses.length ? `WHERE ${searchClauses.join(" AND ")}` : "";
      const countRows = await select<{ status: TicketRecord["status"]; total: string; needs: string }>(`SELECT status, count(*) AS total,
          count(*) FILTER (WHERE status IN ('OPEN', 'ASSIGNED') AND last_message_by = 'learner') AS needs
        FROM helpdesk_tickets ${searchWhere} GROUP BY status`, [...params]);
      const counts = emptyCounts();
      for (const row of countRows) {
        if (!(TICKET_STATUSES as readonly string[]).includes(row.status)) continue;
        counts[row.status] = Number(row.total);
        counts.all += Number(row.total);
        counts.needs_reply += Number(row.needs);
      }
      const clauses = [...searchClauses];
      if (query.status === "needs_reply") clauses.push("status IN ('OPEN', 'ASSIGNED') AND last_message_by = 'learner'");
      else if (query.status) { params.push(query.status); clauses.push(`status = $${params.length}`); }
      if (query.cursor) {
        params.push(query.cursor.updatedAt, query.cursor.id);
        clauses.push(`(updated_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }
      params.push(query.limit + 1);
      const rows = await select(`SELECT ${TICKET_COLUMNS},
          (SELECT left(m.body, ${PREVIEW_SOURCE_CHARS}) FROM helpdesk_ticket_messages m WHERE m.ticket_id = helpdesk_tickets.id ORDER BY m.created_at, m.id LIMIT 1) AS first_message,
          ARRAY(SELECT g.tag FROM helpdesk_ticket_tags g WHERE g.ticket_id = helpdesk_tickets.id ORDER BY g.created_at, g.tag) AS tags
        FROM helpdesk_tickets ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY updated_at DESC, id DESC LIMIT $${params.length}`, params);
      return { tickets: rows.map((row): TicketListItem => ({ ...ticketFromRow(row), firstMessage: row.first_message ?? "", tags: row.tags ?? [] })), counts };
    },
    async countTicketsByUser(userId) {
      return Number((await select<{ total: string }>("SELECT count(*) AS total FROM helpdesk_tickets WHERE user_id = $1", [userId]))[0].total);
    },
    async markRead(ticketId, seenSequence) {
      // One conditional UPDATE: learner activity committed after the agent's
      // snapshot (an event by the learner above that sequence) keeps the dot;
      // agent-only events (tags, flags, internal notes) do not.
      await select(`UPDATE helpdesk_tickets t SET unread_by_agent = FALSE WHERE t.id = $1 AND t.unread_by_agent AND ($2::int IS NULL OR NOT EXISTS (
          SELECT 1 FROM helpdesk_ticket_events e WHERE e.subject = t.id AND e.sequence > $2::int AND e.data->'actor'->>'kind' = 'learner'))`, [ticketId, seenSequence]);
    },
    async listAutoConfirmDue(nowIso, userId) {
      const params: unknown[] = [nowIso];
      if (userId) params.push(userId);
      return (await select(`SELECT ${TICKET_COLUMNS} FROM helpdesk_tickets WHERE status = 'PENDING_CONFIRM' AND confirm_due_at <= $1
        ${userId ? "AND user_id = $2" : ""} ORDER BY confirm_due_at LIMIT ${AUTO_CONFIRM_BATCH}`, params)).map(ticketFromRow);
    },
    async findAttachment(id) {
      const row = (await select(`SELECT ${ATTACHMENT_COLUMNS} FROM helpdesk_attachments WHERE id = $1`, [id]))[0];
      return row ? attachmentFromRow(row) : null;
    },
    // Both use the existing indexes: helpdesk_tickets (user_id, ...) and helpdesk_ticket_messages (ticket_id, created_at, id).
    async nthRecentTicketAt(userId, sinceIso, n) {
      const row = (await select<{ created_at: Date }>("SELECT created_at FROM helpdesk_tickets WHERE user_id = $1 AND created_at > $2 ORDER BY created_at DESC OFFSET $3 LIMIT 1", [userId, sinceIso, n - 1]))[0];
      return row ? iso(row.created_at) : null;
    },
    async nthRecentLearnerMessageAt(userId, sinceIso, n) {
      const row = (await select<{ created_at: Date }>(`SELECT m.created_at FROM helpdesk_ticket_messages m JOIN helpdesk_tickets t ON t.id = m.ticket_id
        WHERE t.user_id = $1 AND m.author_kind = 'learner' AND m.created_at > $2 ORDER BY m.created_at DESC OFFSET $3 LIMIT 1`, [userId, sinceIso, n - 1]))[0];
      return row ? iso(row.created_at) : null;
    },
    async insertAssist(record) {
      const rows = await select(`INSERT INTO helpdesk_assist_log (id, learner_id, source, locale, question, faq_id, faq_question, answer, feedback, ticket_id, client_event_id, payload_hash, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING id`,
      [record.id, record.learnerId, record.source, record.locale, record.question, record.faqId, record.faqQuestion, record.answer, record.feedback, record.ticketId, record.clientEventId, record.payloadHash, record.createdAt]);
      return rows.length ? "inserted" : "duplicate";
    },
    async findAssist(id) {
      const row = (await select(`SELECT ${ASSIST_COLUMNS} FROM helpdesk_assist_log WHERE id = $1`, [id]))[0];
      return row ? assistFromRow(row) : null;
    },
    async findAssistByKey(clientEventId) {
      const row = (await select(`SELECT ${ASSIST_COLUMNS} FROM helpdesk_assist_log WHERE client_event_id = $1`, [clientEventId]))[0];
      return row ? assistFromRow(row) : null;
    },
    async setAssistFeedback(id, learnerId, feedback) {
      // First value wins: one conditional UPDATE, then read what is stored.
      await select("UPDATE helpdesk_assist_log SET feedback = $3 WHERE id = $1 AND learner_id = $2 AND feedback IS NULL", [id, learnerId, feedback]);
      const row = (await select(`SELECT ${ASSIST_COLUMNS} FROM helpdesk_assist_log WHERE id = $1 AND learner_id = $2`, [id, learnerId]))[0];
      return row ? assistFromRow(row) : null;
    },
    async nthRecentAssistAt(learnerId, sinceIso, n, sources) {
      const row = (await select<{ created_at: Date }>(`SELECT created_at FROM helpdesk_assist_log WHERE learner_id = $1 AND created_at > $2 AND source = ANY($3::text[])
        ORDER BY created_at DESC OFFSET $4 LIMIT 1`, [learnerId, sinceIso, [...sources], n - 1]))[0];
      return row ? iso(row.created_at) : null;
    },
    async conversationRootAssist(learnerId, sinceIso) {
      const row = (await select<{ id: string }>(`SELECT id FROM helpdesk_assist_log WHERE learner_id = $1 AND created_at > $2 AND ticket_id IS NULL
        ORDER BY created_at, id LIMIT 1`, [learnerId, sinceIso]))[0];
      return row ? row.id : null;
    },
    async recordAssistDelivery(id, atIso, delivered) {
      await select(`UPDATE helpdesk_assist_log SET feedback_attempted_at = $2,
          feedback_delivered_at = CASE WHEN $3::boolean THEN COALESCE(feedback_delivered_at, $2) ELSE feedback_delivered_at END
        WHERE id = $1`, [id, atIso, delivered]);
    },
    async listUndeliveredAssists(sinceIso, limit) {
      return (await select(`SELECT ${ASSIST_COLUMNS} FROM helpdesk_assist_log
        WHERE feedback IS NOT NULL AND feedback_delivered_at IS NULL AND created_at > $1
        ORDER BY feedback_attempted_at ASC NULLS FIRST, created_at, id LIMIT $2`, [sinceIso, limit])).map(assistFromRow);
    },
    async listAssistsByTicket(ticketId) {
      return (await select(`SELECT ${ASSIST_COLUMNS} FROM helpdesk_assist_log WHERE ticket_id = $1 ORDER BY created_at, id`, [ticketId])).map(assistFromRow);
    }
  };
}
