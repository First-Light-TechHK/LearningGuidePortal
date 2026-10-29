// AI Support Assistant, learner side (tickets-v2-figma-addendum §4a/§4b).
// Admin owns the FAQs and picks the answer (the model may only choose a
// candidate FAQ id; the answer comes back verbatim). Portal only asks, shows
// what Admin returned, and keeps the record of what was shown: every answer
// (chat, starter chip, submit-time modal) is a helpdesk_assist_log row, and
// the learner's feedback is stored there first-wins and forwarded to Admin.
// The BackOffice reads these rows through the ticket (aiAssist), never text a
// browser sent. Any Admin failure or the timeout is a null reply.
// v3 (helpdesk-v3-alternatives-rating): with no answer Admin may offer up to
// three "You might be asking" FAQs (chosen in Admin's code, never by the
// model); Portal passes them on, keeps them with the row, and stores the
// learner's 1-5 rating of an answer (first wins) for the BackOffice.
import { createHash } from "node:crypto";
import {
  HELPDESK_LIMITS,
  HelpdeskProblem,
  type AdminSuggestReply,
  type AdminSuggestRequest,
  type AssistFeedback,
  type AssistantRatingResponse,
  type HelpdeskAlternative,
  type AssistSource,
  type AssistantFeedbackResponse,
  type AssistantInput,
  type AssistantResponse,
  type HelpdeskSuggestion,
  type SuggestInput,
  type SuggestionOutcome,
  type SuggestionResponse
} from "@/contracts/helpdesk";
import { textLength } from "@/contracts/helpdeskText";
import { uuidv7 } from "@/lib/uuidv7";
import { ADMIN_SUGGEST_TIMEOUT_MS } from "./adminClient";
import type { AssistRecord, HelpdeskRepository } from "./repository";
import type { LearnerIdentity } from "./service";

const RATE_WINDOW_MS = 3_600_000;
/** Chat and chips share the learner's hourly budget; submit-time checks have their own (HELPDESK_LIMITS.submitChecksPerHour). */
const LIMITED_SOURCES: readonly AssistSource[] = ["chat", "chip"];
const SUBMIT_SOURCES: readonly AssistSource[] = ["submit"];
/** Feedback Admin has not confirmed is retried for this long, a few rows per sweep. */
const REDELIVERY_WINDOW_MS = 7 * 24 * 3_600_000;
const REDELIVERY_BATCH = 5;
/**
 * Requests in flight on this instance by Idempotency-Key: a second request
 * with the same key waits for the first and replays it instead of asking
 * Admin again (a double click or a retry racing the original).
 */
const askInFlight = new Map<string, Promise<unknown>>();

export type AssistantAdmin = {
  suggest(input: AdminSuggestRequest): Promise<HelpdeskSuggestion | null>;
  /** v3: the answer and, without one, Admin's alternatives. Used when present; an Admin client without it means no alternatives. */
  suggestReply?(input: AdminSuggestRequest): Promise<AdminSuggestReply>;
  reportOutcome(suggestionId: string, outcome: AssistFeedback): Promise<boolean>;
};

export type AssistantDeps = {
  repository: Pick<HelpdeskRepository, "insertAssist" | "findAssist" | "findAssistByKey" | "setAssistFeedback" | "nthRecentAssistAt" | "recordAssistDelivery" | "listUndeliveredAssists" | "conversationRootAssist" | "conversationShownFaqIds" | "insertAiRating">;
  admin: AssistantAdmin;
  now?: () => Date;
  log?: (line: Record<string, unknown>) => void;
  /** Upper bound on waiting for Admin (v2 §4b: 4 s). */
  timeoutMs?: number;
};

function clip(text: string, max: number) {
  return textLength(text) <= max ? text : [...text].slice(0, max).join("");
}

/**
 * What Portal passes on (defensively, whatever Admin sent): none next to an
 * answer, never the FAQ just shown (the chip asked), each FAQ once, at most
 * HELPDESK_LIMITS.alternativesMax. "Just shown" is the chip asked and every
 * FAQ the conversation already showed (shownFaqIds).
 */
function offered(reply: AdminSuggestReply, request: AdminSuggestRequest): HelpdeskAlternative[] {
  if (reply.suggestion) return [];
  const shown = new Set([request.faqId, ...(request.shownFaqIds ?? [])].filter((id): id is string => Boolean(id)).map((id) => id.toLowerCase()));
  const found: HelpdeskAlternative[] = [];
  for (const item of reply.alternatives ?? []) {
    if (found.length >= HELPDESK_LIMITS.alternativesMax) break;
    if (typeof item?.faqId !== "string" || typeof item.question !== "string" || !item.question) continue;
    const faqId = item.faqId.toLowerCase();
    if (shown.has(faqId) || found.some((entry) => entry.faqId === faqId)) continue;
    found.push({ faqId, question: clip(item.question, 200) });
  }
  return found;
}

function hashOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createAssistantService(deps: AssistantDeps) {
  const repository = deps.repository;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  const timeoutMs = deps.timeoutMs ?? ADMIN_SUGGEST_TIMEOUT_MS;

  /** Admin's answer and alternatives; no answer and none on no match, any failure or the timeout. */
  async function askAdmin(request: AdminSuggestRequest): Promise<SuggestionResponse> {
    const nothing: SuggestionResponse = { suggestion: null, alternatives: [] };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<SuggestionResponse>((resolve) => { timer = setTimeout(() => resolve(nothing), timeoutMs); });
    const asked: Promise<AdminSuggestReply> = deps.admin.suggestReply
      ? deps.admin.suggestReply(request)
      : deps.admin.suggest(request).then((suggestion) => ({ suggestion, alternatives: [] }));
    try {
      return await Promise.race([asked.then((reply) => ({ suggestion: reply.suggestion, alternatives: offered(reply, request) })).catch((error: unknown) => {
        log({ type: "helpdesk", event: "assistant_admin_failed", source: request.source, error: error instanceof Error ? error.name : "unknown" });
        return nothing;
      }), late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The run ids for Admin's trace: runId is the row this answer will be
   * stored as (so a null, failed or timed-out answer stays traceable), and
   * parentRunId the first row of the learner's open conversation (unlinked,
   * inside the ticket link window), or null when this run starts one.
   */
  async function runIds(learnerId: string): Promise<{ runId: string; parentRunId: string | null; shownFaqIds?: string[] }> {
    const at = now();
    const since = new Date(at.getTime() - HELPDESK_LIMITS.assistLinkWindowHours * 3_600_000).toISOString();
    const [parentRunId, shownFaqIds] = await Promise.all([
      repository.conversationRootAssist(learnerId, since).catch(() => null),
      // v3: what this conversation already showed, so Admin's alternatives never repeat it; a failed lookup only means none.
      repository.conversationShownFaqIds(learnerId, since, HELPDESK_LIMITS.shownFaqIdsMax).catch(() => [] as string[])
    ]);
    return { runId: uuidv7(at.getTime()), parentRunId, ...(shownFaqIds.length ? { shownFaqIds } : {}) };
  }

  function record(runId: string, learner: LearnerIdentity, source: AssistSource, locale: AssistRecord["locale"], question: string, { suggestion: reply, alternatives }: SuggestionResponse, at: Date, key: string | null, hash: string | null): AssistRecord {
    return {
      // Admin answers with the run id; an older Admin may still send its own suggestion id.
      id: reply?.id ?? runId, learnerId: learner.id, source, locale, question: clip(question, HELPDESK_LIMITS.assistQuestionMax),
      faqId: reply?.faqId ?? null, faqQuestion: reply ? clip(reply.question, 200) : null, answer: reply ? clip(reply.answer, 4000) : null,
      feedback: null, ticketId: null, clientEventId: key, payloadHash: hash, createdAt: at.toISOString(), feedbackDeliveredAt: null, feedbackAttemptedAt: null,
      alternatives: reply ? [] : alternatives
    };
  }

  function replyOf(row: AssistRecord): AssistantResponse {
    const reply = row.answer !== null && row.faqId !== null ? { id: row.id, faqId: row.faqId, question: row.faqQuestion ?? "", answer: row.answer } : null;
    return { id: row.id, reply, alternatives: reply ? [] : row.alternatives };
  }

  async function replay(key: string, hash: string): Promise<AssistantResponse | null> {
    const earlier = await repository.findAssistByKey(key);
    if (!earlier) return null;
    if (earlier.payloadHash !== hash) throw new HelpdeskProblem("idempotency_conflict", "This Idempotency-Key was already used for a different request.");
    return replyOf(earlier);
  }

  async function enforceRateLimit(learnerId: string) {
    const at = now();
    const oldest = await repository.nthRecentAssistAt(learnerId, new Date(at.getTime() - RATE_WINDOW_MS).toISOString(), HELPDESK_LIMITS.assistantPerHour, LIMITED_SOURCES);
    if (!oldest) return;
    const retryAfter = Math.max(1, Math.ceil((Date.parse(oldest) + RATE_WINDOW_MS - at.getTime()) / 1000));
    log({ type: "helpdesk", event: "rate_limited", limit: "assistant", retryAfter });
    throw new HelpdeskProblem("rate_limited", `You can ask at most ${HELPDESK_LIMITS.assistantPerHour} questions an hour. Try again later.`, { retryAfter });
  }

  /** POST /api/helpdesk/assistant: one chat question or starter chip (faqId). */
  async function ask(learner: LearnerIdentity, input: AssistantInput, key: string): Promise<{ response: AssistantResponse; replayed: boolean }> {
    const hash = hashOf({ op: "assistant", learnerId: learner.id, message: input.message, locale: input.locale, faqId: input.faqId });
    const running = askInFlight.get(key);
    if (running) {
      await running.catch(() => undefined);
      const stored = await replay(key, hash);
      if (stored) return { response: stored, replayed: true };
    }
    const work = askOnce(learner, input, key, hash);
    askInFlight.set(key, work);
    try {
      return await work;
    } finally {
      if (askInFlight.get(key) === work) askInFlight.delete(key);
    }
  }

  async function askOnce(learner: LearnerIdentity, input: AssistantInput, key: string, hash: string): Promise<{ response: AssistantResponse; replayed: boolean }> {
    const earlier = await replay(key, hash);
    if (earlier) return { response: earlier, replayed: true };
    await enforceRateLimit(learner.id);
    const source: AssistSource = input.faqId ? "chip" : "chat";
    const run = await runIds(learner.id);
    const request: AdminSuggestRequest = { learnerId: learner.id, locale: input.locale, source, message: input.message, ...(input.faqId ? { faqId: input.faqId } : {}), ...run };
    const reply = await askAdmin(request);
    const row = record(run.runId, learner, source, input.locale, input.message, reply, now(), key, hash);
    if ((await repository.insertAssist(row)) === "duplicate") {
      // The same key raced in, or Admin repeated a suggestion id: answer with what is stored.
      const stored = await replay(key, hash);
      if (stored) return { response: stored, replayed: true };
      throw new HelpdeskProblem("idempotency_conflict", "This answer was already recorded.");
    }
    return { response: replyOf(row), replayed: false };
  }

  /** Tells Admin the stored feedback unless it already confirmed it; true when Admin has it. */
  async function deliver(row: AssistRecord): Promise<boolean> {
    if (row.feedback === null) return false;
    if (row.feedbackDeliveredAt) return true;
    const delivered = await deps.admin.reportOutcome(row.id, row.feedback).catch(() => false);
    await repository.recordAssistDelivery(row.id, now().toISOString(), delivered);
    if (!delivered) log({ type: "helpdesk", event: "assistant_outcome_not_delivered", feedback: row.feedback });
    return delivered;
  }

  /** The sweep: forwards a few outcomes Admin has not confirmed (never tried first, then least recently tried). Returns how many Admin took. */
  async function deliverPending(): Promise<number> {
    const rows = await repository.listUndeliveredAssists(new Date(now().getTime() - REDELIVERY_WINDOW_MS).toISOString(), REDELIVERY_BATCH);
    let delivered = 0;
    for (const row of rows) if (await deliver(row)) delivered += 1;
    return delivered;
  }

  /** Forwards one row's stored outcome (e.g. the "declined" a new ticket recorded); true when Admin has it. */
  async function deliverOutcome(id: string): Promise<boolean> {
    const row = await repository.findAssist(id);
    if (!row) return false;
    const delivered = await deliver(row);
    if (delivered) await deliverPending();
    return delivered;
  }

  async function storeFeedback(learner: LearnerIdentity, id: string, feedback: AssistFeedback, sources: readonly AssistSource[]) {
    const row = await repository.findAssist(id);
    if (!row || row.learnerId !== learner.id || row.answer === null || !sources.includes(row.source)) throw new HelpdeskProblem("not_found", "No such answer.");
    const stored = await repository.setAssistFeedback(id, learner.id, feedback);
    if (!stored) throw new HelpdeskProblem("not_found", "No such answer.");
    // Admin keeps its own first-wins record: forward what is stored until Admin confirms it,
    // and while Admin is answering, also catch up on outcomes it missed earlier.
    const delivered = await deliver(stored);
    if (delivered) await deliverPending();
    return { stored, delivered };
  }

  /** POST /api/helpdesk/assistant/{id}/feedback ("Helpful?" Yes / No): first value wins. */
  async function feedback(learner: LearnerIdentity, id: string, helpful: boolean): Promise<AssistantFeedbackResponse> {
    const { stored } = await storeFeedback(learner, id, helpful ? "helpful" : "not_helpful", LIMITED_SOURCES);
    return { id: stored.id, feedback: stored.feedback };
  }

  /**
   * The submit-time check (1333:249): Admin's suggestion for the enquiry,
   * logged with source submit, and without one Admin's alternatives (v3 §1;
   * the page offers them before submitting). Never blocks: over the budget,
   * on a failure or the timeout it is no answer and no alternatives.
   */
  async function checkForSubmit(learner: LearnerIdentity, input: SuggestInput): Promise<SuggestionResponse> {
    // Over the hourly budget the learner simply gets no suggestion: Admin is not asked and nothing is logged.
    const at = now();
    if (await repository.nthRecentAssistAt(learner.id, new Date(at.getTime() - RATE_WINDOW_MS).toISOString(), HELPDESK_LIMITS.submitChecksPerHour, SUBMIT_SOURCES)) {
      log({ type: "helpdesk", event: "rate_limited", limit: "submit_check" });
      return { suggestion: null, alternatives: [] };
    }
    const run = await runIds(learner.id);
    const reply = await askAdmin({ learnerId: learner.id, locale: input.locale, source: "submit", category: input.category, subject: input.subject, message: input.message, ...run });
    const row = record(run.runId, learner, "submit", input.locale, input.subject, reply, now(), null, null);
    if ((await repository.insertAssist(row)) === "duplicate") log({ type: "helpdesk", event: "assistant_duplicate_suggestion" });
    return reply;
  }

  /** The v2 view of checkForSubmit: the suggestion, or null. */
  async function suggestForSubmit(learner: LearnerIdentity, input: SuggestInput): Promise<HelpdeskSuggestion | null> {
    return (await checkForSubmit(learner, input)).suggestion;
  }

  /**
   * POST /api/helpdesk/assistant/{id}/rating (v3 §2): the learner's 1-5
   * rating of an answer they were shown (the submit suggestion or a chosen
   * alternative; any of their answered rows). One per answer: the first is
   * kept, a repeat with the same value answers with it, a different value is
   * 409 answer_already_rated. Stored in Portal only; the BackOffice reads it
   * on aiAssist.
   */
  async function rate(learner: LearnerIdentity, id: string, rating: number): Promise<AssistantRatingResponse> {
    const row = await repository.findAssist(id);
    if (!row || row.learnerId !== learner.id || row.answer === null) throw new HelpdeskProblem("not_found", "No such answer.");
    const stored = await repository.insertAiRating({ runId: row.id, learnerId: learner.id, source: row.source, rating, createdAt: now().toISOString() });
    if (stored !== rating) throw new HelpdeskProblem("answer_already_rated", "This answer was already rated.", { rating: stored });
    return { id: row.id, rating: stored };
  }

  /** What the learner did in the submit-time modal: stored first-wins, then forwarded (Admin being down does not lose it). */
  async function submitOutcome(learner: LearnerIdentity, id: string, outcome: SuggestionOutcome): Promise<AssistantFeedbackResponse & { delivered: boolean }> {
    const { stored, delivered } = await storeFeedback(learner, id, outcome, ["submit"]);
    return { id: stored.id, feedback: stored.feedback, delivered };
  }

  return { ask, feedback, checkForSubmit, suggestForSubmit, submitOutcome, rate, deliverOutcome, deliverPending };
}

export type AssistantService = ReturnType<typeof createAssistantService>;
