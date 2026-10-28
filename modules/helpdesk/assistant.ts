// AI Support Assistant, learner side (tickets-v2-figma-addendum §4a/§4b).
// Admin owns the FAQs and picks the answer (the model may only choose a
// candidate FAQ id; the answer comes back verbatim). Portal only asks, shows
// what Admin returned, and keeps the record of what was shown: every answer
// (chat, starter chip, submit-time modal) is a helpdesk_assist_log row, and
// the learner's feedback is stored there first-wins and forwarded to Admin.
// The BackOffice reads these rows through the ticket (aiAssist), never text a
// browser sent. Any Admin failure or the timeout is a null reply.
import { createHash } from "node:crypto";
import {
  HELPDESK_LIMITS,
  HelpdeskProblem,
  type AdminSuggestRequest,
  type AssistFeedback,
  type AssistSource,
  type AssistantFeedbackResponse,
  type AssistantInput,
  type AssistantResponse,
  type HelpdeskSuggestion,
  type SuggestInput,
  type SuggestionOutcome
} from "@/contracts/helpdesk";
import { textLength } from "@/contracts/helpdeskText";
import { uuidv7 } from "@/lib/uuidv7";
import { ADMIN_SUGGEST_TIMEOUT_MS } from "./adminClient";
import type { AssistRecord, HelpdeskRepository } from "./repository";
import type { LearnerIdentity } from "./service";

const RATE_WINDOW_MS = 3_600_000;
/** Chat and chips share the learner's hourly budget; submit-time checks are limited by Admin. */
const LIMITED_SOURCES: readonly AssistSource[] = ["chat", "chip"];

export type AssistantAdmin = {
  suggest(input: AdminSuggestRequest): Promise<HelpdeskSuggestion | null>;
  reportOutcome(suggestionId: string, outcome: AssistFeedback): Promise<boolean>;
};

export type AssistantDeps = {
  repository: Pick<HelpdeskRepository, "insertAssist" | "findAssist" | "findAssistByKey" | "setAssistFeedback" | "nthRecentAssistAt">;
  admin: AssistantAdmin;
  now?: () => Date;
  log?: (line: Record<string, unknown>) => void;
  /** Upper bound on waiting for Admin (v2 §4b: 4 s). */
  timeoutMs?: number;
};

function clip(text: string, max: number) {
  return textLength(text) <= max ? text : [...text].slice(0, max).join("");
}

function hashOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createAssistantService(deps: AssistantDeps) {
  const repository = deps.repository;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  const timeoutMs = deps.timeoutMs ?? ADMIN_SUGGEST_TIMEOUT_MS;

  /** Admin's answer, or null on no match, any failure or the timeout. */
  async function askAdmin(request: AdminSuggestRequest): Promise<HelpdeskSuggestion | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    try {
      return await Promise.race([deps.admin.suggest(request).catch((error: unknown) => {
        log({ type: "helpdesk", event: "assistant_admin_failed", source: request.source, error: error instanceof Error ? error.name : "unknown" });
        return null;
      }), late]);
    } finally {
      clearTimeout(timer);
    }
  }

  function record(learner: LearnerIdentity, source: AssistSource, locale: AssistRecord["locale"], question: string, reply: HelpdeskSuggestion | null, at: Date, key: string | null, hash: string | null): AssistRecord {
    return {
      id: reply?.id ?? uuidv7(at.getTime()), learnerId: learner.id, source, locale, question: clip(question, HELPDESK_LIMITS.assistQuestionMax),
      faqId: reply?.faqId ?? null, faqQuestion: reply ? clip(reply.question, 200) : null, answer: reply ? clip(reply.answer, 4000) : null,
      feedback: null, ticketId: null, clientEventId: key, payloadHash: hash, createdAt: at.toISOString()
    };
  }

  function replyOf(row: AssistRecord): AssistantResponse {
    return { id: row.id, reply: row.answer !== null && row.faqId !== null ? { id: row.id, faqId: row.faqId, question: row.faqQuestion ?? "", answer: row.answer } : null };
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
    const earlier = await replay(key, hash);
    if (earlier) return { response: earlier, replayed: true };
    await enforceRateLimit(learner.id);
    const source: AssistSource = input.faqId ? "chip" : "chat";
    const request: AdminSuggestRequest = { learnerId: learner.id, locale: input.locale, source, message: input.message, ...(input.faqId ? { faqId: input.faqId } : {}) };
    const reply = await askAdmin(request);
    const row = record(learner, source, input.locale, input.message, reply, now(), key, hash);
    if ((await repository.insertAssist(row)) === "duplicate") {
      // The same key raced in, or Admin repeated a suggestion id: answer with what is stored.
      const stored = await replay(key, hash);
      if (stored) return { response: stored, replayed: true };
      throw new HelpdeskProblem("idempotency_conflict", "This answer was already recorded.");
    }
    return { response: replyOf(row), replayed: false };
  }

  async function storeFeedback(learner: LearnerIdentity, id: string, feedback: AssistFeedback, sources: readonly AssistSource[]) {
    const row = await repository.findAssist(id);
    if (!row || row.learnerId !== learner.id || row.answer === null || !sources.includes(row.source)) throw new HelpdeskProblem("not_found", "No such answer.");
    const stored = await repository.setAssistFeedback(id, learner.id, feedback);
    if (!stored) throw new HelpdeskProblem("not_found", "No such answer.");
    // Admin keeps its own first-wins record; tell it only when this call set the value.
    const first = row.feedback === null && stored.feedback === feedback;
    const delivered = first ? await deps.admin.reportOutcome(id, feedback).catch(() => false) : true;
    if (!delivered) log({ type: "helpdesk", event: "assistant_outcome_not_delivered", feedback });
    return { stored, delivered };
  }

  /** POST /api/helpdesk/assistant/{id}/feedback ("Helpful?" Yes / No): first value wins. */
  async function feedback(learner: LearnerIdentity, id: string, helpful: boolean): Promise<AssistantFeedbackResponse> {
    const { stored } = await storeFeedback(learner, id, helpful ? "helpful" : "not_helpful", LIMITED_SOURCES);
    return { id: stored.id, feedback: stored.feedback };
  }

  /** The submit-time check (1333:249): Admin's suggestion for the enquiry, logged with source submit. */
  async function suggestForSubmit(learner: LearnerIdentity, input: SuggestInput): Promise<HelpdeskSuggestion | null> {
    const reply = await askAdmin({ learnerId: learner.id, locale: input.locale, source: "submit", category: input.category, subject: input.subject, message: input.message });
    const row = record(learner, "submit", input.locale, input.subject, reply, now(), null, null);
    if ((await repository.insertAssist(row)) === "duplicate") log({ type: "helpdesk", event: "assistant_duplicate_suggestion" });
    return reply;
  }

  /** What the learner did in the submit-time modal: stored first-wins, then forwarded (Admin being down does not lose it). */
  async function submitOutcome(learner: LearnerIdentity, id: string, outcome: SuggestionOutcome): Promise<AssistantFeedbackResponse & { delivered: boolean }> {
    const { stored, delivered } = await storeFeedback(learner, id, outcome, ["submit"]);
    return { id: stored.id, feedback: stored.feedback, delivered };
  }

  return { ask, feedback, suggestForSubmit, submitOutcome };
}

export type AssistantService = ReturnType<typeof createAssistantService>;
