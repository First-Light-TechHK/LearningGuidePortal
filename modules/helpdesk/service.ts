// Helpdesk application service: the only place ticket state changes.
// Order of checks for every command: ownership (404) -> idempotency replay /
// conflict -> lazy auto-confirm -> expectedSequence (409 stale_ticket, except
// across events the actor never sees, see ignoredByStaleCheck) -> transition
// table (409 invalid_transition and friends) -> per-learner rate limit for
// new tickets and learner messages (429 rate_limited) -> one atomic write ->
// learner notification and email (failures are logged, never returned).
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
  type StudentProjection,
  type SubscriptionProjection,
  HELPDESK_LIMITS,
  isContactEmail
} from "@/contracts/helpdesk";
import { uuidv7 } from "@/lib/uuidv7";
import { attachmentFileName, sniffAttachment } from "./attachments";
import type { StudentDirectoryEntry } from "./studentDirectory";
import {
  CONFIRM_WINDOW_HOURS,
  EVENT_SOURCE,
  decide,
  eventName,
  eventType,
  evolve,
  followUpUntil,
  ignoredByStaleCheck,
  isAutoConfirmDue,
  isLearnerVisibleEvent,
  needsReply,
  raisesUnreadByAgent,
  type Actor,
  type AttachmentRecord,
  type Command,
  type Decision,
  type EventRecord,
  type MessageRecord,
  type TicketAggregate,
  type TicketRecord
} from "./domain";
import type { HelpdeskRepository, TicketListItem } from "./repository";

export type LearnerIdentity = { id: string; email: string; name: string };
export type LearnerUpdateKind = "agent_replied" | "resolution_proposed";
export type HelpdeskNotification = { userId: string; ticketId: string; number: string; locale: HelpdeskLocale; kind: LearnerUpdateKind; title: string; body: string };
/** A plain-text email to the ticket's contact email (Figma: "we will reply to you by email"). */
export type HelpdeskEmail = { to: string; subject: string; text: string; ticketId: string; number: string; locale: HelpdeskLocale; kind: LearnerUpdateKind };
/** remove (optional) deletes bytes written for a change that then did not commit. */
export type HelpdeskBlobStore = { put(key: string, bytes: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array>; remove?(key: string): Promise<void> };
export type HelpdeskDeps = {
  repository: HelpdeskRepository;
  blobs: HelpdeskBlobStore;
  notify?: (notification: HelpdeskNotification) => Promise<void>;
  email?: (email: HelpdeskEmail) => Promise<void>;
  /** Absolute link to the learner's ticket page, or null when no public origin is configured. */
  ticketLink?: (ticketId: string, locale: HelpdeskLocale) => string | null;
  /** Read-only student / subscription projection for the BackOffice detail. */
  studentDirectory?: (userId: string) => Promise<StudentDirectoryEntry | null>;
  now?: () => Date;
  log?: (line: Record<string, unknown>) => void;
};
export type CommandResult<T> = { ticket: T; replayed: boolean };
export type AttachmentContent = { bytes: Uint8Array; contentType: HelpdeskAttachmentType; fileName: string };

const LEARNER_ATTACHMENT_URL = "/api/helpdesk/attachments/";
const AGENT_ATTACHMENT_URL = "/api/integration/helpdesk/attachments/";

const RATE_WINDOW_MS = 3_600_000;

/** Tags commute, so a tag write that lost a sequence race is simply retried on the new sequence. */
const TAG_RETRIES = 6;

// The owner asked (2026-10-28 06:50Z) for the short confirm wording everywhere.
const NOTIFICATION_COPY: Record<HelpdeskLocale, Record<LearnerUpdateKind, string>> = {
  "en-GB": { agent_replied: "Support replied to your request", resolution_proposed: "Is it solved?" },
  "zh-CN": { agent_replied: "客服回复了你的工单", resolution_proposed: "问题解决了吗？" }
};

/** Email copy, in the ticket's locale. The subject carries only the ticket number, never learner text. */
export function helpdeskEmail(kind: LearnerUpdateKind, ticket: Pick<TicketRecord, "id" | "number" | "subject" | "locale" | "contactEmail">, link: string | null, reply?: string): HelpdeskEmail {
  const zh = ticket.locale === "zh-CN";
  const lines: string[] = [];
  let subject: string;
  if (kind === "agent_replied") {
    subject = zh ? `[${ticket.number}] 客服回复了你的咨询` : `[${ticket.number}] Support replied to your enquiry`;
    lines.push(zh ? "你好：" : "Hello,", "", zh ? `客服回复了你的咨询「${ticket.subject}」（${ticket.number}）：` : `Our support team replied to your enquiry "${ticket.subject}" (${ticket.number}):`, "", reply ?? "");
    if (link) lines.push("", zh ? `查看或回复：${link}` : `View or reply: ${link}`);
  } else {
    subject = zh ? `[${ticket.number}] 问题解决了吗？` : `[${ticket.number}] Is it solved?`;
    lines.push(zh ? "你好：" : "Hello,", "", zh ? `客服已处理你的咨询「${ticket.subject}」（${ticket.number}）。问题解决了吗？` : `Support has handled your enquiry "${ticket.subject}" (${ticket.number}). Is it solved?`);
    if (link) lines.push("", zh ? `已解决 / 没解决：${link}` : `Solved / Not yet: ${link}`);
    lines.push("", zh ? `${CONFIRM_WINDOW_HOURS} 小时内未确认将自动结束。` : `If we do not hear from you within ${CONFIRM_WINDOW_HOURS} hours, the enquiry will be closed automatically.`);
  }
  lines.push("", "Learning Guide");
  return { to: ticket.contactEmail, subject, text: lines.join("\n"), ticketId: ticket.id, number: ticket.number, locale: ticket.locale, kind };
}

/** One-line preview of the learner's first message. */
export function previewOf(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, HELPDESK_LIMITS.previewMax);
}

const LEARNER_ACTION_COMMANDS: Array<[LearnerAllowedAction, Command]> = [["reply", "learner_reply"], ["cancel", "cancel"], ["confirm", "confirm"], ["reject", "reject"], ["close", "close"], ["rate", "rate"]];
const AGENT_ACTION_COMMANDS: Array<[AgentAllowedAction, Command]> = [["claim", "claim"], ["reply", "agent_reply"], ["internal_note", "internal_note"], ["propose_resolution", "propose_resolution"]];

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function payloadHash(value: unknown) {
  return sha256(JSON.stringify(value));
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
      contactEmail: ticket.contactEmail,
      assigneeName: ticket.assigneeName,
      closeReason: ticket.closeReason,
      rating: ticket.rating,
      followUpUntil: followUpUntil(ticket, at),
      messages: aggregate.messages.filter((item) => !item.internal).map((item) => ({
        id: item.id, authorKind: item.authorKind, authorName: item.authorName, body: item.body, createdAt: item.createdAt,
        attachments: attachmentViews(aggregate, item, LEARNER_ATTACHMENT_URL)
      })),
      timeline: aggregate.events.filter((item) => isLearnerVisibleEvent(eventName(item.type))).map((item) => ({
        id: item.id,
        type: eventName(item.type),
        time: item.time,
        fromStatus: item.data.from_state,
        toStatus: item.data.to_state,
        actor: { kind: item.data.actor.kind, name: item.data.actor.name }
      })),
      allowedActions: allowed(ticket, LEARNER_ACTION_COMMANDS, "learner", at)
    };
  }

  function agentSummary(ticket: TicketRecord, extra: { firstMessage: string; tags: string[] }): AgentTicketSummary {
    return {
      ...learnerSummary(ticket),
      locale: ticket.locale,
      learner: { id: ticket.userId, email: ticket.userEmail, name: ticket.userName },
      assignee: ticket.assigneeId ? { id: ticket.assigneeId, name: ticket.assigneeName || "" } : null,
      needsReply: needsReply(ticket),
      contactEmail: ticket.contactEmail,
      preview: previewOf(extra.firstMessage),
      unreadByAgent: ticket.unreadByAgent,
      tags: extra.tags
    };
  }

  async function studentProjection(ticket: TicketRecord): Promise<{ student: StudentProjection; subscription: SubscriptionProjection | null }> {
    let entry: StudentDirectoryEntry | null = null;
    if (deps.studentDirectory) {
      try { entry = await deps.studentDirectory(ticket.userId); }
      catch (error) { log({ type: "helpdesk", event: "student_directory_failed", ticketId: ticket.id, error: error instanceof Error ? error.name : "unknown" }); }
    }
    const totalEnquiries = await repository.countTicketsByUser(ticket.userId);
    return {
      student: {
        id: ticket.userId,
        name: entry?.name || ticket.userName,
        accountEmail: entry ? entry.accountEmail ?? "" : ticket.userEmail,
        contactEmail: ticket.contactEmail,
        joinedAt: entry?.joinedAt ?? null,
        totalEnquiries,
        currentCourse: entry?.currentCourse ?? null
      },
      subscription: entry?.subscription ?? null
    };
  }

  function cloudEvent(event: EventRecord): HelpdeskCloudEvent {
    return { id: event.id, specversion: "1.0", source: EVENT_SOURCE, type: event.type, subject: event.subject, time: event.time, datacontenttype: "application/json", data: event.data, sequence: event.sequence };
  }

  async function agentDetail(aggregate: TicketAggregate): Promise<AgentTicketDetail> {
    const at = now();
    const { ticket } = aggregate;
    const projection = await studentProjection(ticket);
    return {
      ...agentSummary(ticket, { firstMessage: aggregate.messages[0]?.body ?? "", tags: aggregate.tags }),
      learner: { id: ticket.userId, email: ticket.userEmail, name: ticket.userName, locale: ticket.locale },
      suggestionId: ticket.suggestionId,
      student: projection.student,
      subscription: projection.subscription,
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

  function eventData(from: TicketRecord["status"] | null, to: TicketRecord["status"], actor: Actor, extra: { reason?: string; messageId?: string; rating?: number; suggestionId?: string; tag?: string }): HelpdeskEventData {
    const data: HelpdeskEventData = { from_state: from, to_state: to, actor: { kind: actor.kind, id: actor.id, name: actor.name } };
    if (extra.reason) data.reason = extra.reason;
    if (extra.messageId) data.message_id = extra.messageId;
    if (extra.rating !== undefined) data.rating = extra.rating;
    if (extra.suggestionId) data.suggestion_id = extra.suggestionId;
    if (extra.tag) data.tag = extra.tag;
    return data;
  }

  async function storeUploads(files: UploadInput[], ticketId: string, messageId: string, at: Date): Promise<AttachmentRecord[]> {
    const prepared = files.map((file) => {
      const contentType = sniffAttachment(file.bytes, file.fileName);
      if (!contentType) throw new HelpdeskProblem("attachment_type_unsupported", "Use PNG, JPG, WebP, GIF, PDF, TXT, CSV, DOCX or XLSX files.");
      const id = uuidv7(at.getTime());
      return { file, record: { id, ticketId, messageId, uploaderKind: "learner" as const, fileName: attachmentFileName(file.fileName, contentType), contentType, sizeBytes: file.bytes.byteLength, storageKey: attachmentStorageKey(ticketId, id), createdAt: at.toISOString() } };
    });
    const written: AttachmentRecord[] = [];
    try {
      for (const item of prepared) {
        await deps.blobs.put(item.record.storageKey, item.file.bytes);
        written.push(item.record);
      }
    } catch (error) {
      await discardUploads(written);
      throw error;
    }
    return prepared.map((item) => item.record);
  }

  /** Best effort: bytes of a change that did not commit (lost race, reused key, failure) are deleted again. */
  async function discardUploads(attachments: AttachmentRecord[]) {
    const blobs = deps.blobs;
    if (!blobs.remove || attachments.length === 0) return;
    for (const item of attachments) {
      try { await blobs.remove(item.storageKey); } catch (error) {
        log({ type: "helpdesk", event: "attachment_cleanup_failed", ticketId: item.ticketId, attachmentId: item.id, error: error instanceof Error ? error.name : "unknown" });
      }
    }
  }

  /**
   * Per-learner limits over a rolling hour, counted from the stored tickets
   * and messages (no counter table). Requests racing each other can pass a
   * limit by a few; it is a brake on floods, not an exact quota.
   */
  async function enforceRateLimit(kind: "tickets" | "messages", learnerId: string) {
    const at = now();
    const since = new Date(at.getTime() - RATE_WINDOW_MS).toISOString();
    const limit = kind === "tickets" ? HELPDESK_LIMITS.ticketsPerHour : HELPDESK_LIMITS.learnerMessagesPerHour;
    const oldest = kind === "tickets" ? await repository.nthRecentTicketAt(learnerId, since, limit) : await repository.nthRecentLearnerMessageAt(learnerId, since, limit);
    if (!oldest) return;
    const retryAfter = Math.max(1, Math.ceil((Date.parse(oldest) + RATE_WINDOW_MS - at.getTime()) / 1000));
    log({ type: "helpdesk", event: "rate_limited", limit: kind, retryAfter });
    throw new HelpdeskProblem("rate_limited", kind === "tickets" ? `You can open at most ${limit} enquiries an hour. Try again later.` : `You can send at most ${limit} messages an hour. Try again later.`, { retryAfter });
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

  async function notifyLearner(ticket: TicketRecord, kind: LearnerUpdateKind, reply?: string) {
    if (deps.notify) {
      try {
        await deps.notify({ userId: ticket.userId, ticketId: ticket.id, number: ticket.number, locale: ticket.locale, kind, title: NOTIFICATION_COPY[ticket.locale][kind], body: `${ticket.number} · ${ticket.subject}` });
      } catch {
        log({ type: "helpdesk", event: "notification_failed", ticketId: ticket.id, kind });
      }
    }
    if (deps.email) {
      try {
        let link: string | null = null;
        try { link = deps.ticketLink ? deps.ticketLink(ticket.id, ticket.locale) : null; } catch { link = null; }
        await deps.email(helpdeskEmail(kind, ticket, link, reply));
      } catch (error) {
        // Never log the address or the message: only which ticket and why.
        log({ type: "helpdesk", event: "email_failed", ticketId: ticket.id, kind, error: error instanceof Error ? error.name : "unknown" });
      }
    }
  }

  type CommandSpec = {
    ticketId: string;
    ownerId?: string;
    key: string;
    hash: string;
    actor: Actor;
    command: Command;
    /** null applies the command to the current sequence (tags only). */
    expectedSequence: number | null;
    message?: { body: string; internal: boolean; files: UploadInput[] };
    rating?: number;
    tag?: string;
  };

  function staleProblem(currentSequence: number) {
    return new HelpdeskProblem("stale_ticket", "This request was updated. Reload it and try again.", { currentSequence });
  }

  /** The caller's view is current enough: nothing they could have acted on happened after expectedSequence. */
  function checkSequence(aggregate: TicketAggregate, expectedSequence: number | null, actor: Actor["kind"]) {
    const current = aggregate.ticket.sequence;
    if (expectedSequence === null || expectedSequence === current) return;
    const unseen = aggregate.events.filter((item) => item.sequence > expectedSequence);
    const harmless = expectedSequence < current && unseen.length === current - expectedSequence && unseen.every((item) => ignoredByStaleCheck(eventName(item.type), actor));
    if (!harmless) throw staleProblem(current);
  }

  async function runCommand(spec: CommandSpec): Promise<{ aggregate: TicketAggregate; replayed: boolean }> {
    let aggregate = await load(spec.ticketId, spec.ownerId);
    if (await replayed(spec.key, spec.hash, spec.ticketId)) return { aggregate: await fresh(aggregate), replayed: true };
    aggregate = await fresh(aggregate);
    const ticket = aggregate.ticket;
    checkSequence(aggregate, spec.expectedSequence, spec.actor.kind);
    const at = now();
    const decision = decide(ticket, spec.command, spec.actor.kind, at);
    if (!decision.ok) reject(ticket, spec.command, spec.actor.kind, decision);
    if (spec.tag !== undefined) {
      // Tags are idempotent: adding a present tag or removing a missing one changes nothing.
      const present = aggregate.tags.includes(spec.tag);
      if (spec.command === "add_tag" ? present : !present) return { aggregate, replayed: false };
      if (spec.command === "add_tag" && aggregate.tags.length >= HELPDESK_LIMITS.tagsPerTicket) throw new HelpdeskProblem("tag_limit_reached", `A ticket can have at most ${HELPDESK_LIMITS.tagsPerTicket} tags.`);
    }

    let message: MessageRecord | undefined;
    let attachments: AttachmentRecord[] = [];
    if (spec.message) {
      if (spec.actor.kind === "learner" && spec.actor.id) await enforceRateLimit("messages", spec.actor.id);
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
      data: eventData(ticket.status, next.status, spec.actor, { reason: autoClaimed ? "auto_claimed" : decision.transition.closeReason, messageId: message?.id, rating: spec.rating, tag: spec.tag }),
      key: spec.key, hash: spec.hash
    });
    let outcome: Awaited<ReturnType<HelpdeskRepository["appendChange"]>>;
    try {
      outcome = await repository.appendChange({
        ticket: next, expectedSequence: ticket.sequence, message, attachments, event,
        tag: spec.tag === undefined ? undefined : { op: spec.command === "add_tag" ? "add" : "remove", tag: spec.tag, at: at.toISOString() },
        markUnread: raisesUnreadByAgent(decision.transition, spec.actor.kind, Boolean(message && !message.internal))
      });
    } catch (error) {
      await discardUploads(attachments);
      throw error;
    }
    if (outcome !== "applied") {
      await discardUploads(attachments);
      if (await replayed(spec.key, spec.hash, spec.ticketId)) return { aggregate: await load(spec.ticketId), replayed: true };
      if (outcome === "duplicate") throw new HelpdeskProblem("idempotency_conflict", "This Idempotency-Key was already used for a different request.");
      throw staleProblem((await load(spec.ticketId)).ticket.sequence);
    }
    if (decision.transition.event === "agent_replied") await notifyLearner(next, "agent_replied", message?.body);
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
    const accountEmail = learner.email.trim();
    const contactEmail = input.contactEmail || (accountEmail && isContactEmail(accountEmail) ? accountEmail : null);
    if (!contactEmail) throw new HelpdeskProblem("validation_failed", "Add an email address so support can reply.", {}, "contactEmail");
    const suggestionId = input.suggestionId ?? null;
    const hash = payloadHash({ op: "create", userId: learner.id, category: input.category, subject: input.subject, body: input.body, locale: input.locale, contactEmail, suggestionId, files: fileFingerprints(input.files) });
    const replayTicket = async () => {
      const ticketId = await replayed(key, hash, null);
      if (!ticketId) return null;
      return { ticket: learnerDetail(await fresh(await load(ticketId, learner.id))), replayed: true };
    };
    const earlier = await replayTicket();
    if (earlier) return earlier;
    await enforceRateLimit("tickets", learner.id);
    await enforceRateLimit("messages", learner.id);
    const at = now();
    const ticketId = uuidv7(at.getTime());
    const messageId = uuidv7(at.getTime());
    const attachments = await storeUploads(input.files, ticketId, messageId, at);
    const createdAt = at.toISOString();
    const decision = decide(null, "create", "learner", at);
    if (!decision.ok) throw new HelpdeskProblem("invalid_transition");
    const actor: Actor = { kind: "learner", id: learner.id, name: learner.name };
    const events = [buildEvent({ ticketId, sequence: 1, name: decision.transition.event, at, data: eventData(null, decision.to, actor, { messageId }), key, hash })];
    if (suggestionId) {
      // "No, still submit to support team": record which suggestion did not help (addendum §B).
      const declined = decide({ status: decision.to, assigneeId: null, confirmDueAt: null, closedAt: null, rating: null }, "decline_suggestion", "learner", at);
      if (!declined.ok) throw new HelpdeskProblem("invalid_transition");
      events.push(buildEvent({ ticketId, sequence: 2, name: declined.transition.event, at, data: eventData(decision.to, declined.to, actor, { suggestionId }), key: null, hash: null }));
    }
    let outcome: Awaited<ReturnType<HelpdeskRepository["insertTicket"]>>;
    try {
      outcome = await repository.insertTicket({
        ticket: {
          id: ticketId, userId: learner.id, userEmail: learner.email, userName: learner.name, contactEmail, locale: input.locale, category: input.category, subject: input.subject,
          status: decision.to, assigneeId: null, assigneeName: null, sequence: events.length, confirmDueAt: null, closedAt: null, closeReason: null, rating: null,
          createdAt, updatedAt: createdAt, lastMessageAt: createdAt, lastMessageBy: "learner", clientEventId: key, payloadHash: hash, suggestionId, unreadByAgent: true
        },
        message: { id: messageId, ticketId, authorKind: "learner", authorId: learner.id, authorName: learner.name, body: input.body, internal: false, attachmentIds: attachments.map((item) => item.id), clientEventId: key, payloadHash: hash, createdAt },
        attachments,
        events
      });
    } catch (error) {
      await discardUploads(attachments);
      throw error;
    }
    if (outcome.status === "duplicate") {
      await discardUploads(attachments);
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
    return { tickets: page.map((item: TicketListItem) => agentSummary(item, item)), nextCursor: tickets.length > query.limit && last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null, counts };
  }

  async function getAgentTicket(ticketId: string): Promise<AgentTicketDetail> {
    return agentDetail(await fresh(await load(ticketId)));
  }

  async function postAgentMessage(ticketId: string, input: AgentMessageInput, key: string): Promise<CommandResult<AgentTicketDetail>> {
    const hash = payloadHash({ op: "agent_message", ticketId, agent: input.agent, body: input.body, internal: input.internal });
    const result = await runCommand({ ticketId, key, hash, actor: { kind: "agent", id: input.agent.id, name: input.agent.name }, command: input.internal ? "internal_note" : "agent_reply", expectedSequence: input.expectedSequence, message: { body: input.body, internal: input.internal, files: [] } });
    return { ticket: await agentDetail(result.aggregate), replayed: result.replayed };
  }

  async function agentAction(ticketId: string, input: AgentActionInput, key: string): Promise<CommandResult<AgentTicketDetail>> {
    const actor: Actor = { kind: "agent", id: input.agent.id, name: input.agent.name };
    if (input.action === "mark_read") {
      // Not an event: it only clears the BackOffice unread dot, so it never makes anyone stale.
      // expectedSequence (the snapshot the agent saw) keeps a newer learner message unread.
      await load(ticketId);
      await repository.markRead(ticketId, input.expectedSequence);
      return { ticket: await agentDetail(await fresh(await load(ticketId))), replayed: false };
    }
    const hash = payloadHash({ op: "agent_action", ticketId, agent: input.agent, action: input.action, ...(input.tag !== undefined ? { tag: input.tag } : {}) });
    if (input.action === "add_tag" || input.action === "remove_tag") {
      if (!input.tag) throw new HelpdeskProblem("validation_failed", "tag is required.", {}, "tag");
      // Tags commute: apply to the current sequence and retry a lost race a few times.
      for (let attempt = 1; ; attempt += 1) {
        try {
          const result = await runCommand({ ticketId, key, hash, actor, command: input.action, expectedSequence: input.expectedSequence, tag: input.tag });
          return { ticket: await agentDetail(result.aggregate), replayed: result.replayed };
        } catch (error) {
          if (!(error instanceof HelpdeskProblem) || error.code !== "stale_ticket" || attempt >= TAG_RETRIES || input.expectedSequence !== null) throw error;
          await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 20 * attempt)));
        }
      }
    }
    if (input.expectedSequence === null) throw new HelpdeskProblem("validation_failed", "expectedSequence must be a positive integer.", {}, "expectedSequence");
    const result = await runCommand({ ticketId, key, hash, actor, command: input.action, expectedSequence: input.expectedSequence });
    return { ticket: await agentDetail(result.aggregate), replayed: result.replayed };
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
