// Helpdesk application service: the only place ticket state changes.
// Order of checks for every command: ownership (404) -> idempotency replay /
// conflict -> lazy auto-confirm -> expectedSequence (409 stale_ticket) ->
// transition table (409 invalid_transition and friends) -> one atomic write.
// The idempotency payload hash covers the actor, the ticket and the command
// content, not expectedSequence, so a retried request replays.
import { createHash } from "node:crypto";
import {
  HelpdeskProblem,
  encodeCursor,
  type AgentActionInput,
  type AgentAllowedAction,
  type AgentListQuery,
  type AgentMessageInput,
  type AgentTicketDetail,
  type AgentTicketList,
  type AgentTicketSummary,
  type AttachmentView,
  type CreateTicketInput,
  type HelpdeskAttachmentType,
  type HelpdeskCloudEvent,
  type HelpdeskEventData,
  type HelpdeskEventName,
  type HelpdeskLocale,
  type LearnerActionInput,
  type LearnerAllowedAction,
  type LearnerMessageInput,
  type LearnerTicketList,
  type TicketDetail,
  type TicketSummary,
  type UploadInput,
  HELPDESK_LIMITS
} from "@/contracts/helpdesk";
import { uuidv7 } from "@/lib/uuidv7";
import { sniffImage } from "@/services/portalMedia";
import {
  EVENT_SOURCE,
  decide,
  eventType,
  evolve,
  followUpUntil,
  isAutoConfirmDue,
  needsReply,
  type Actor,
  type AttachmentRecord,
  type Command,
  type Decision,
  type EventRecord,
  type MessageRecord,
  type TicketAggregate,
  type TicketRecord
} from "./domain";
import type { HelpdeskRepository } from "./repository";

export type LearnerIdentity = { id: string; email: string; name: string };
export type HelpdeskNotification = { userId: string; ticketId: string; number: string; locale: HelpdeskLocale; kind: "agent_replied" | "resolution_proposed"; title: string; body: string };
export type HelpdeskBlobStore = { put(key: string, bytes: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array> };
export type HelpdeskDeps = {
  repository: HelpdeskRepository;
  blobs: HelpdeskBlobStore;
  notify?: (notification: HelpdeskNotification) => Promise<void>;
  now?: () => Date;
  log?: (line: Record<string, unknown>) => void;
};
export type CommandResult<T> = { ticket: T; replayed: boolean };
export type AttachmentContent = { bytes: Uint8Array; contentType: HelpdeskAttachmentType; fileName: string };

const LEARNER_ATTACHMENT_URL = "/api/helpdesk/attachments/";
const AGENT_ATTACHMENT_URL = "/api/integration/helpdesk/attachments/";

const NOTIFICATION_COPY: Record<HelpdeskLocale, Record<HelpdeskNotification["kind"], string>> = {
  "en-GB": { agent_replied: "Support replied to your request", resolution_proposed: "Is your request solved? Please confirm" },
  "zh-CN": { agent_replied: "客服回复了你的工单", resolution_proposed: "你的问题解决了吗？请确认" }
};

const LEARNER_ACTION_COMMANDS: Array<[LearnerAllowedAction, Command]> = [["reply", "learner_reply"], ["cancel", "cancel"], ["confirm", "confirm"], ["reject", "reject"], ["close", "close"], ["rate", "rate"]];
const AGENT_ACTION_COMMANDS: Array<[AgentAllowedAction, Command]> = [["claim", "claim"], ["reply", "agent_reply"], ["internal_note", "internal_note"], ["propose_resolution", "propose_resolution"]];

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function payloadHash(value: unknown) {
  return sha256(JSON.stringify(value));
}

function cleanFileName(name: string, contentType: HelpdeskAttachmentType) {
  const base = (name.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop() || "").trim().slice(0, HELPDESK_LIMITS.fileNameMax);
  return base || `screenshot.${contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp"}`;
}

function fileFingerprints(files: UploadInput[]) {
  return files.map((file) => ({ name: file.fileName, sha256: sha256(file.bytes) }));
}

export function attachmentStorageKey(ticketId: string, attachmentId: string) {
  return `learning_guide/helpdesk_attachments/${ticketId}/${attachmentId}.bin`;
}

export function createHelpdeskService(deps: HelpdeskDeps) {
  const repository = deps.repository;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));

  // ---------------------------------------------------------------- views

  function attachmentViews(aggregate: TicketAggregate, message: MessageRecord, base: string): AttachmentView[] {
    return message.attachmentIds
      .map((id) => aggregate.attachments.find((item) => item.id === id))
      .filter((item): item is AttachmentRecord => Boolean(item))
      .map((item) => ({ id: item.id, fileName: item.fileName, contentType: item.contentType, sizeBytes: item.sizeBytes, url: `${base}${item.id}` }));
  }

  function learnerSummary(ticket: TicketRecord): TicketSummary {
    return {
      id: ticket.id, number: ticket.number, subject: ticket.subject, category: ticket.category, status: ticket.status,
      createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, lastMessageAt: ticket.lastMessageAt, lastMessageBy: ticket.lastMessageBy,
      confirmDueAt: ticket.confirmDueAt, closedAt: ticket.closedAt, sequence: ticket.sequence
    };
  }

  function allowed<T extends string>(ticket: TicketRecord, pairs: Array<[T, Command]>, actor: Actor["kind"], at: Date): T[] {
    return pairs.filter(([, command]) => decide(ticket, command, actor, at).ok).map(([name]) => name);
  }

  function learnerDetail(aggregate: TicketAggregate): TicketDetail {
    const at = now();
    const { ticket } = aggregate;
    return {
      ...learnerSummary(ticket),
      locale: ticket.locale,
      assigneeName: ticket.assigneeName,
      closeReason: ticket.closeReason,
      rating: ticket.rating,
      followUpUntil: followUpUntil(ticket, at),
      messages: aggregate.messages.filter((item) => !item.internal).map((item) => ({
        id: item.id, authorKind: item.authorKind, authorName: item.authorName, body: item.body, createdAt: item.createdAt,
        attachments: attachmentViews(aggregate, item, LEARNER_ATTACHMENT_URL)
      })),
      timeline: aggregate.events.filter((item) => !item.type.endsWith(".internal_note_added")).map((item) => ({
        id: item.id,
        type: item.type.slice(item.type.lastIndexOf(".") + 1) as HelpdeskEventName,
        time: item.time,
        fromStatus: item.data.from_state,
        toStatus: item.data.to_state,
        actor: { kind: item.data.actor.kind, name: item.data.actor.name }
      })),
      allowedActions: allowed(ticket, LEARNER_ACTION_COMMANDS, "learner", at)
    };
  }

  function agentSummary(ticket: TicketRecord): AgentTicketSummary {
    return {
      ...learnerSummary(ticket),
      locale: ticket.locale,
      learner: { id: ticket.userId, email: ticket.userEmail, name: ticket.userName },
      assignee: ticket.assigneeId ? { id: ticket.assigneeId, name: ticket.assigneeName || "" } : null,
      needsReply: needsReply(ticket)
    };
  }

  function cloudEvent(event: EventRecord): HelpdeskCloudEvent {
    return { id: event.id, specversion: "1.0", source: EVENT_SOURCE, type: event.type, subject: event.subject, time: event.time, datacontenttype: "application/json", data: event.data, sequence: event.sequence };
  }

  function agentDetail(aggregate: TicketAggregate): AgentTicketDetail {
    const at = now();
    const { ticket } = aggregate;
    return {
      ...agentSummary(ticket),
      learner: { id: ticket.userId, email: ticket.userEmail, name: ticket.userName, locale: ticket.locale },
      closeReason: ticket.closeReason,
      rating: ticket.rating,
      followUpUntil: followUpUntil(ticket, at),
      messages: aggregate.messages.map((item) => ({
        id: item.id, authorKind: item.authorKind, authorId: item.authorId, authorName: item.authorName, body: item.body, internal: item.internal,
        createdAt: item.createdAt, attachments: attachmentViews(aggregate, item, AGENT_ATTACHMENT_URL)
      })),
      events: aggregate.events.map(cloudEvent),
      allowedActions: allowed(ticket, AGENT_ACTION_COMMANDS, "agent", at)
    };
  }

  // ---------------------------------------------------------------- helpers

  function buildEvent(input: { ticketId: string; sequence: number; name: HelpdeskEventName; at: Date; data: HelpdeskEventData; key: string | null; hash: string | null }): EventRecord {
    return {
      id: uuidv7(input.at.getTime()), specversion: "1.0", source: EVENT_SOURCE, type: eventType(input.name), subject: input.ticketId,
      time: input.at.toISOString(), datacontenttype: "application/json", data: input.data, sequence: input.sequence,
      clientEventId: input.key, payloadHash: input.hash
    };
  }

  function eventData(from: TicketRecord["status"] | null, to: TicketRecord["status"], actor: Actor, extra: { reason?: string; messageId?: string; rating?: number }): HelpdeskEventData {
    const data: HelpdeskEventData = { from_state: from, to_state: to, actor: { kind: actor.kind, id: actor.id, name: actor.name } };
    if (extra.reason) data.reason = extra.reason;
    if (extra.messageId) data.message_id = extra.messageId;
    if (extra.rating !== undefined) data.rating = extra.rating;
    return data;
  }

  async function storeUploads(files: UploadInput[], ticketId: string, messageId: string, at: Date): Promise<AttachmentRecord[]> {
    const prepared = files.map((file) => {
      const contentType = sniffImage(Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength));
      if (!contentType) throw new HelpdeskProblem("attachment_type_unsupported", "Use a PNG, JPG or WebP image.");
      const id = uuidv7(at.getTime());
      return { file, record: { id, ticketId, messageId, uploaderKind: "learner" as const, fileName: cleanFileName(file.fileName, contentType), contentType, sizeBytes: file.bytes.byteLength, storageKey: attachmentStorageKey(ticketId, id), createdAt: at.toISOString() } };
    });
    for (const item of prepared) await deps.blobs.put(item.record.storageKey, item.file.bytes);
    return prepared.map((item) => item.record);
  }

  async function load(ticketId: string, ownerId?: string): Promise<TicketAggregate> {
    const aggregate = await repository.findTicket(ticketId);
    if (!aggregate || (ownerId !== undefined && aggregate.ticket.userId !== ownerId)) throw new HelpdeskProblem("not_found", "No such ticket.");
    return aggregate;
  }

  async function autoConfirmTicket(ticket: TicketRecord) {
    const at = now();
    if (!isAutoConfirmDue(ticket, at)) return false;
    const decision = decide(ticket, "auto_confirm", "system", at);
    if (!decision.ok) return false;
    const actor: Actor = { kind: "system", id: null, name: null };
    const next = evolve(ticket, decision, { now: at, actor, publicMessage: false });
    const event = buildEvent({ ticketId: ticket.id, sequence: next.sequence, name: decision.transition.event, at, data: eventData(ticket.status, next.status, actor, { reason: "auto_confirmed" }), key: null, hash: null });
    // "stale" means someone else already moved the ticket (possibly this same auto-confirm): either way the read reloads.
    await repository.appendChange({ ticket: next, expectedSequence: ticket.sequence, attachments: [], event });
    return true;
  }

  async function fresh(aggregate: TicketAggregate): Promise<TicketAggregate> {
    if (await autoConfirmTicket(aggregate.ticket)) return load(aggregate.ticket.id);
    return aggregate;
  }

  async function replayed(key: string, hash: string, ticketId: string | null): Promise<string | null> {
    const existing = await repository.findCommandByKey(key);
    if (!existing) return null;
    if (existing.payloadHash !== hash || (ticketId !== null && existing.ticketId !== ticketId)) throw new HelpdeskProblem("idempotency_conflict", "This Idempotency-Key was already used for a different request.");
    return existing.ticketId;
  }

  function reject(ticket: TicketRecord, command: Command, actor: Actor["kind"], decision: Extract<Decision, { ok: false }>): never {
    log({ type: "helpdesk", event: "transition_rejected", ticketId: ticket.id, number: ticket.number, from: ticket.status, command, actor, code: decision.code });
    throw new HelpdeskProblem(decision.code);
  }

  async function notifyLearner(ticket: TicketRecord, kind: HelpdeskNotification["kind"]) {
    if (!deps.notify) return;
    try {
      await deps.notify({ userId: ticket.userId, ticketId: ticket.id, number: ticket.number, locale: ticket.locale, kind, title: NOTIFICATION_COPY[ticket.locale][kind], body: `${ticket.number} · ${ticket.subject}` });
    } catch {
      log({ type: "helpdesk", event: "notification_failed", ticketId: ticket.id, kind });
    }
  }

  type CommandSpec = {
    ticketId: string;
    ownerId?: string;
    key: string;
    hash: string;
    actor: Actor;
    command: Command;
    expectedSequence: number;
    message?: { body: string; internal: boolean; files: UploadInput[] };
    rating?: number;
  };

  async function runCommand(spec: CommandSpec): Promise<{ aggregate: TicketAggregate; replayed: boolean }> {
    let aggregate = await load(spec.ticketId, spec.ownerId);
    if (await replayed(spec.key, spec.hash, spec.ticketId)) return { aggregate: await fresh(aggregate), replayed: true };
    aggregate = await fresh(aggregate);
    const ticket = aggregate.ticket;
    if (ticket.sequence !== spec.expectedSequence) throw new HelpdeskProblem("stale_ticket", "This request was updated. Reload it and try again.", { currentSequence: ticket.sequence });
    const at = now();
    const decision = decide(ticket, spec.command, spec.actor.kind, at);
    if (!decision.ok) reject(ticket, spec.command, spec.actor.kind, decision);

    let message: MessageRecord | undefined;
    let attachments: AttachmentRecord[] = [];
    if (spec.message) {
      const messageId = uuidv7(at.getTime());
      attachments = await storeUploads(spec.message.files, ticket.id, messageId, at);
      message = {
        id: messageId, ticketId: ticket.id, authorKind: spec.actor.kind, authorId: spec.actor.id, authorName: spec.actor.name,
        body: spec.message.body, internal: spec.message.internal, attachmentIds: attachments.map((item) => item.id),
        clientEventId: spec.key, payloadHash: spec.hash, createdAt: at.toISOString()
      };
    }
    const next = evolve(ticket, decision, { now: at, actor: spec.actor, publicMessage: Boolean(message && !message.internal), rating: spec.rating });
    const autoClaimed = spec.command === "agent_reply" && !ticket.assigneeId;
    const event = buildEvent({
      ticketId: ticket.id, sequence: next.sequence, name: decision.transition.event, at,
      data: eventData(ticket.status, next.status, spec.actor, { reason: autoClaimed ? "auto_claimed" : decision.transition.closeReason, messageId: message?.id, rating: spec.rating }),
      key: spec.key, hash: spec.hash
    });
    const outcome = await repository.appendChange({ ticket: next, expectedSequence: ticket.sequence, message, attachments, event });
    if (outcome !== "applied") {
      if (await replayed(spec.key, spec.hash, spec.ticketId)) return { aggregate: await load(spec.ticketId), replayed: true };
      if (outcome === "duplicate") throw new HelpdeskProblem("idempotency_conflict", "This Idempotency-Key was already used for a different request.");
      const current = await load(spec.ticketId);
      throw new HelpdeskProblem("stale_ticket", "This request was updated. Reload it and try again.", { currentSequence: current.ticket.sequence });
    }
    if (decision.transition.event === "agent_replied") await notifyLearner(next, "agent_replied");
    if (decision.transition.event === "resolution_proposed") await notifyLearner(next, "resolution_proposed");
    return { aggregate: await load(spec.ticketId), replayed: false };
  }

  async function sweepAutoConfirm(userId?: string) {
    for (const ticket of await repository.listAutoConfirmDue(now().toISOString(), userId)) await autoConfirmTicket(ticket);
  }

  async function readAttachment(id: string, ownerId?: string): Promise<AttachmentContent> {
    const attachment = await repository.findAttachment(id);
    if (!attachment) throw new HelpdeskProblem("not_found", "No such attachment.");
    const aggregate = await repository.findTicket(attachment.ticketId);
    const message = aggregate?.messages.find((item) => item.id === attachment.messageId);
    if (!aggregate || !message || (ownerId !== undefined && (aggregate.ticket.userId !== ownerId || message.internal))) throw new HelpdeskProblem("not_found", "No such attachment.");
    return { bytes: await deps.blobs.get(attachment.storageKey), contentType: attachment.contentType, fileName: attachment.fileName };
  }

  // ---------------------------------------------------------------- learner

  async function createTicket(learner: LearnerIdentity, input: CreateTicketInput, key: string): Promise<CommandResult<TicketDetail>> {
    const hash = payloadHash({ op: "create", userId: learner.id, category: input.category, subject: input.subject, body: input.body, locale: input.locale, files: fileFingerprints(input.files) });
    const replayTicket = async () => {
      const ticketId = await replayed(key, hash, null);
      if (!ticketId) return null;
      return { ticket: learnerDetail(await fresh(await load(ticketId, learner.id))), replayed: true };
    };
    const earlier = await replayTicket();
    if (earlier) return earlier;
    const at = now();
    const ticketId = uuidv7(at.getTime());
    const messageId = uuidv7(at.getTime());
    const attachments = await storeUploads(input.files, ticketId, messageId, at);
    const createdAt = at.toISOString();
    const decision = decide(null, "create", "learner", at);
    if (!decision.ok) throw new HelpdeskProblem("invalid_transition");
    const actor: Actor = { kind: "learner", id: learner.id, name: learner.name };
    const outcome = await repository.insertTicket({
      ticket: {
        id: ticketId, userId: learner.id, userEmail: learner.email, userName: learner.name, locale: input.locale, category: input.category, subject: input.subject,
        status: decision.to, assigneeId: null, assigneeName: null, sequence: 1, confirmDueAt: null, closedAt: null, closeReason: null, rating: null,
        createdAt, updatedAt: createdAt, lastMessageAt: createdAt, lastMessageBy: "learner", clientEventId: key, payloadHash: hash
      },
      message: { id: messageId, ticketId, authorKind: "learner", authorId: learner.id, authorName: learner.name, body: input.body, internal: false, attachmentIds: attachments.map((item) => item.id), clientEventId: key, payloadHash: hash, createdAt },
      attachments,
      event: buildEvent({ ticketId, sequence: 1, name: decision.transition.event, at, data: eventData(null, decision.to, actor, { messageId }), key, hash })
    });
    if (outcome.status === "duplicate") {
      const later = await replayTicket();
      if (later) return later;
      throw new HelpdeskProblem("idempotency_conflict", "This Idempotency-Key was already used for a different request.");
    }
    return { ticket: learnerDetail(await load(ticketId)), replayed: false };
  }

  async function listLearnerTickets(learner: LearnerIdentity): Promise<LearnerTicketList> {
    await sweepAutoConfirm(learner.id);
    return { tickets: (await repository.listTicketsByUser(learner.id)).map(learnerSummary) };
  }

  async function getLearnerTicket(learner: LearnerIdentity, ticketId: string): Promise<TicketDetail> {
    return learnerDetail(await fresh(await load(ticketId, learner.id)));
  }

  async function learnerMessage(learner: LearnerIdentity, ticketId: string, input: LearnerMessageInput, key: string): Promise<CommandResult<TicketDetail>> {
    const hash = payloadHash({ op: "learner_message", userId: learner.id, ticketId, body: input.body, files: fileFingerprints(input.files) });
    const result = await runCommand({ ticketId, ownerId: learner.id, key, hash, actor: { kind: "learner", id: learner.id, name: learner.name }, command: "learner_reply", expectedSequence: input.expectedSequence, message: { body: input.body, internal: false, files: input.files } });
    return { ticket: learnerDetail(result.aggregate), replayed: result.replayed };
  }

  async function learnerAction(learner: LearnerIdentity, ticketId: string, input: LearnerActionInput, key: string): Promise<CommandResult<TicketDetail>> {
    const hash = payloadHash({ op: "learner_action", userId: learner.id, ticketId, action: input.action, rating: input.rating ?? null, message: input.message ?? null });
    const result = await runCommand({
      ticketId, ownerId: learner.id, key, hash, actor: { kind: "learner", id: learner.id, name: learner.name }, command: input.action, expectedSequence: input.expectedSequence,
      message: input.action === "reject" && input.message ? { body: input.message, internal: false, files: [] } : undefined,
      rating: input.action === "rate" ? input.rating : undefined
    });
    return { ticket: learnerDetail(result.aggregate), replayed: result.replayed };
  }

  // ---------------------------------------------------------------- agent

  async function listAgentTickets(query: AgentListQuery): Promise<AgentTicketList> {
    await sweepAutoConfirm();
    const { tickets, counts } = await repository.listTickets(query);
    const page = tickets.slice(0, query.limit);
    const last = page[page.length - 1];
    return { tickets: page.map(agentSummary), nextCursor: tickets.length > query.limit && last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null, counts };
  }

  async function getAgentTicket(ticketId: string): Promise<AgentTicketDetail> {
    return agentDetail(await fresh(await load(ticketId)));
  }

  async function postAgentMessage(ticketId: string, input: AgentMessageInput, key: string): Promise<CommandResult<AgentTicketDetail>> {
    const hash = payloadHash({ op: "agent_message", ticketId, agent: input.agent, body: input.body, internal: input.internal });
    const result = await runCommand({ ticketId, key, hash, actor: { kind: "agent", id: input.agent.id, name: input.agent.name }, command: input.internal ? "internal_note" : "agent_reply", expectedSequence: input.expectedSequence, message: { body: input.body, internal: input.internal, files: [] } });
    return { ticket: agentDetail(result.aggregate), replayed: result.replayed };
  }

  async function agentAction(ticketId: string, input: AgentActionInput, key: string): Promise<CommandResult<AgentTicketDetail>> {
    const hash = payloadHash({ op: "agent_action", ticketId, agent: input.agent, action: input.action });
    const result = await runCommand({ ticketId, key, hash, actor: { kind: "agent", id: input.agent.id, name: input.agent.name }, command: input.action, expectedSequence: input.expectedSequence });
    return { ticket: agentDetail(result.aggregate), replayed: result.replayed };
  }

  return {
    createTicket,
    listLearnerTickets,
    getLearnerTicket,
    learnerMessage,
    learnerAction,
    readLearnerAttachment: (learner: LearnerIdentity, attachmentId: string) => readAttachment(attachmentId, learner.id),
    listAgentTickets,
    getAgentTicket,
    postAgentMessage,
    agentAction,
    readAgentAttachment: (attachmentId: string) => readAttachment(attachmentId)
  };
}

export type HelpdeskService = ReturnType<typeof createHelpdeskService>;
