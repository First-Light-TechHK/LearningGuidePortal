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
// v5 (helpdesk-v5-context-chips-and-smalltalk.md, helpdesk-v5-faq-graph-design.md):
// every chat turn belongs to a chat session (helpdesk_chat_sessions), which
// starts with the situation chips Portal's code picks from the learner's own
// records (the signals never go to Admin or the model). A typed question
// carries the context (the card on screen, the session, the learner's own
// last 3 turns, all from Portal's log, never account data) and Admin answers
// with its turn (answer / smalltalk / clarify / no_match); a click on a chip,
// follow-up or option is checked against the cached release's edges and
// rendered from it verbatim with fixed templates (no model, no Admin call).
// The short strings Admin wrote are checked once more here (assistantTurn.ts).
import { createHash } from "node:crypto";
import {
  HELPDESK_LIMITS,
  HelpdeskProblem,
  buildSuggestContext,
  type AdminSuggestReply,
  type AssistantClickInput,
  type AssistantSessionInput,
  type AssistantSessionResponse,
  type AssistantTurn,
  type AssistantTurnResponse,
  type ClickVia,
  type FaqNode,
  type FaqRelease,
  type GuardReason,
  type GuardedField,
  type HelpFaq,
  type HelpdeskLocale,
  type LearnerEndReason,
  type LearnerState,
  type SituationSignal,
  type SuggestTurn,
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
import { TURN_TEMPLATES, excerptOf, frameVariant, nextOf, replyTemplate, screenTurnText, templateVariant } from "./assistantTurn";
import { CHAT_SESSION_RULES } from "./chatSession";
import { releaseGraph, type ReleaseGraph } from "./faqReleaseCache";
import { learnerSignals, type SignalSources } from "./learnerSignals";
import { learnerState, type LearnerStateSources } from "./learnerState";
import { answeredByPortal, type AssistRecord, type AssistTexts, type ChatSessionRecord, type HelpdeskRepository, type TurnUpdate } from "./repository";
import type { LearnerIdentity } from "./service";
import { chooseSituationChips, waitingTicketOf, type ChipCandidate } from "./situationChips";

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
  /** v5: the published FAQs (cached; the chips before Admin has a release). */
  faqs?(locale: HelpdeskLocale): Promise<HelpFaq[] | null>;
  /** v5: one published FAQ (cached; the card a clarify explains when the release does not have it). */
  faq?(id: string, locale: HelpdeskLocale): Promise<HelpFaq | null>;
};

/** v5: the learner's own product records the signals are worked out from (read only; never sent anywhere). */
export type LearnerRecords = Pick<SignalSources, "user" | "orders" | "subscriptions">;

/** v7: how long a typed question waits for the learner state's records before asking Admin without it. */
export const LEARNER_STATE_WAIT_MS = 300;

export type AssistantDeps = {
  repository: Pick<HelpdeskRepository, "insertAssist" | "findAssist" | "findAssistByKey" | "setAssistFeedback" | "nthRecentAssistAt" | "recordAssistDelivery" | "listUndeliveredAssists" | "conversationRootAssist" | "conversationShownFaqIds" | "insertAiRating"
    | "createChatSession" | "findChatSession" | "recordTurn" | "endChatSession" | "sessionShowedNode" | "openEmptyChatSession" | "sessionLearnerTurns" | "setAssistExpanded" | "listTicketsByUser">;
  admin: AssistantAdmin;
  now?: () => Date;
  log?: (line: Record<string, unknown>) => void;
  /** Upper bound on waiting for Admin (v2 §4b: 4 s). */
  timeoutMs?: number;
  /** v5: Admin's published release (the cached copy, modules/helpdesk/faqReleaseCache.ts); without it there is never a release. */
  release?: { current(locale: HelpdeskLocale, options?: { waitMs?: number; minVersion?: number | null }): Promise<FaqRelease | null> };
  /** v5 Part A: the learner's own product records (services/productStore.ts); without it no product signal is ever on. */
  learnerRecords?: (learnerId: string) => Promise<LearnerRecords>;
  /**
   * v7: the records the learner state is worked out from (services/productStore.ts and the Study Group store, read
   * only); without it a typed question carries no state.
   */
  learnerStateSources?: (learnerId: string) => Promise<Omit<LearnerStateSources, "now" | "tickets">>;
  /** v4 Part A: whether the order is the learner's own (the from_order signal). */
  ownsOrder?: (learnerId: string, orderId: string) => Promise<boolean>;
  /** v5 Part G1: the W3C trace id this request's Admin calls carry, logged with the turn. */
  traceId?: string | null;
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

  /** Admin's answer and alternatives (and, v6, its turn); no answer and none on no match, any failure or the timeout. */
  async function askAdmin(request: AdminSuggestRequest): Promise<AdminSuggestReply> {
    const nothing: AdminSuggestReply = { suggestion: null, alternatives: [] };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<AdminSuggestReply>((resolve) => { timer = setTimeout(() => resolve(nothing), timeoutMs); });
    const asked: Promise<AdminSuggestReply> = deps.admin.suggestReply
      ? deps.admin.suggestReply(request)
      : deps.admin.suggest(request).then((suggestion) => ({ suggestion, alternatives: [] }));
    try {
      return await Promise.race([asked.then((reply): AdminSuggestReply => ({ suggestion: reply.suggestion, alternatives: offered(reply, request), ...(reply.turn ? { turn: reply.turn } : {}) })).catch((error: unknown) => {
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

  /** The v3 view of a row: the FAQ card verbatim (never a clarify explanation or a small-talk line, which only the v5 turn carries). */
  function replyOf(row: AssistRecord): AssistantResponse {
    const card = row.kind !== "clarify" && row.kind !== "smalltalk";
    const reply = card && row.answer !== null && row.faqId !== null ? { id: row.id, faqId: row.faqId, question: row.faqQuestion ?? "", answer: row.answer } : null;
    return { id: row.id, reply, alternatives: reply ? [] : row.alternatives };
  }

  // ------------------------------------------------------------ v5: the release, sessions and turns

  const graphs = new WeakMap<FaqRelease, ReleaseGraph>();
  /** The cached release as a graph, or null (no release yet, or Admin not reachable before anything was cached). */
  async function graphFor(locale: HelpdeskLocale, options: { waitMs?: number; minVersion?: number | null } = {}): Promise<ReleaseGraph | null> {
    if (!deps.release) return null;
    const release = await deps.release.current(locale, options).catch(() => null);
    if (!release || release.locale !== locale) return null;
    let graph = graphs.get(release);
    if (!graph) { graph = releaseGraph(release); graphs.set(release, graph); }
    return graph;
  }

  /** The learner's situation signals right now (Part A), from Portal's own records only; any failure means none from that source. */
  async function signalsOf(learner: LearnerIdentity, fromOrder: boolean): Promise<SituationSignal[]> {
    const [records, tickets] = await Promise.all([
      deps.learnerRecords ? deps.learnerRecords(learner.id).catch(() => null) : Promise.resolve(null),
      repository.listTicketsByUser(learner.id).catch(() => [])
    ]);
    return learnerSignals(learner.id, { now: now(), user: records?.user ?? null, orders: records?.orders ?? [], subscriptions: records?.subscriptions ?? [], tickets, fromOrder });
  }

  /** v7: the learner state for a typed question; any failure, or records slower than LEARNER_STATE_WAIT_MS, means none. */
  async function stateOf(learner: LearnerIdentity): Promise<LearnerState | null> {
    const load = deps.learnerStateSources;
    if (!load) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), LEARNER_STATE_WAIT_MS); });
      const sources = await Promise.race([Promise.all([load(learner.id), repository.listTicketsByUser(learner.id)]), timeout]);
      if (!sources) return null;
      const [records, tickets] = sources;
      return learnerState(learner.id, { ...records, now: now(), tickets });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function newSession(learner: LearnerIdentity, locale: HelpdeskLocale, signals: SituationSignal[], releaseVersion: number | null): Promise<ChatSessionRecord> {
    const at = now().toISOString();
    const session: ChatSessionRecord = { id: uuidv7(now().getTime()), learnerId: learner.id, locale, releaseVersion, startedAt: at, lastTurnAt: at, endedAt: null, endReason: null, turns: 0, unsolvedStreak: 0, currentNodeId: null, signals };
    await repository.createChatSession(session);
    return session;
  }

  /**
   * The session a turn belongs to: the one the chat sent when it is the learner's, open, in the same locale and not idle
   * (v4: 10 minutes without a turn ends it, as reason idle); otherwise a new one (its signals worked out now).
   */
  async function sessionFor(learner: LearnerIdentity, locale: HelpdeskLocale, sessionId: string | null): Promise<ChatSessionRecord> {
    const found = sessionId ? await repository.findChatSession(sessionId) : null;
    if (found && found.learnerId === learner.id && found.endedAt === null && found.locale === locale) {
      if (now().getTime() - Date.parse(found.lastTurnAt) < CHAT_SESSION_RULES.idleMs) return found;
      await repository.endChatSession(found.id, learner.id, "idle", new Date(Date.parse(found.lastTurnAt) + CHAT_SESSION_RULES.idleMs).toISOString());
    }
    const graph = await graphFor(locale, { waitMs: 0 });
    return newSession(learner, locale, await signalsOf(learner, false), graph?.release.version ?? null);
  }

  /** Portal's own check of one short string; a refusal is logged (field and reason only, never the text). */
  function screened(field: GuardedField, text: string | null | undefined, groundedIn: string | null = null): { text: string | null; refused: GuardReason | null } {
    if (text === null || text === undefined) return { text: null, refused: null };
    const result = screenTurnText(field, text, groundedIn);
    if (result.text === null) log({ type: "helpdesk", event: "assistant_portal_guard", field, reason: result.reason });
    return { text: result.text, refused: result.text === null ? result.reason : null };
  }

  /** The guard column: Portal's own refusal first, then Admin's result ("passed", or its reason, or "fallback"). */
  function guardOf(turn: SuggestTurn | null, refused: GuardReason | null): string | null {
    if (refused) return refused;
    if (!turn?.guard) return null;
    return turn.guard.result === "passed" ? "passed" : turn.guard.reason ?? "fallback";
  }

  /** The card a clarify explains: the release node, else the published FAQ (cached), else nothing. */
  async function shownCard(graph: ReleaseGraph | null, nodeId: string, locale: HelpdeskLocale): Promise<{ question: string; answer: string } | null> {
    const node = graph?.node(nodeId);
    if (node) return node;
    const faq = deps.admin.faq ? await deps.admin.faq(nodeId, locale).catch(() => null) : null;
    return faq ? { question: faq.question, answer: faq.answer } : null;
  }

  type TurnRow = { row: AssistRecord; update: TurnUpdate };

  /** What the learner typed earlier in the session (Portal's own log), for the frame of a click; none when it cannot be read. */
  function learnerWords(sessionId: string): Promise<string[]> {
    return repository.sessionLearnerTurns(sessionId, HELPDESK_LIMITS.recentTurnsMax).catch(() => [] as string[]);
  }

  /** One typed question's row from Admin's reply: what kind of turn it is, the guarded strings and the card. */
  async function typedRow(base: AssistRecord, reply: AdminSuggestReply, session: ChatSessionRecord, locale: HelpdeskLocale): Promise<TurnRow> {
    const turn = reply.turn ?? null;
    const releaseVersion = turn?.releaseVersion ?? null;
    const columns = { sessionId: session.id, parentNodeId: session.currentNodeId, via: "typed" as const, intent: turn?.intent ?? null, releaseVersion, traceId: deps.traceId ?? null, signals: session.signals, blocks: null, expanded: null };
    const graph = await graphFor(locale, { minVersion: releaseVersion });
    // Portal's own fallbacks speak the learner's language and script, as Admin's templates do (zh-TW for Traditional).
    const variant = templateVariant(base.question, locale);
    if (reply.suggestion) {
      // The card is locked content: whatever kind Admin said, an answer with a card is an answer.
      const node = graph?.node(reply.suggestion.faqId) ?? null;
      const nodeType = node?.type ?? "answer";
      const opening = nodeType === "choice" || !turn ? { text: null, refused: null } : screened("opening", turn.opening);
      const closing = nodeType === "choice" || !turn ? { text: null, refused: null } : screened("closing", turn.closing);
      const excerpt = node && node.answer === reply.suggestion.answer && turn ? excerptOf(node, turn.blocks) : null;
      const texts: AssistTexts = {
        // An Admin with turns frames an answer node always (its template when its own line failed); Portal's template when Portal refused it.
        opening: turn && nodeType === "answer" ? opening.text ?? TURN_TEMPLATES[variant].opening : null,
        closing: turn && nodeType === "answer" ? closing.text ?? TURN_TEMPLATES[variant].closing : null,
        reply: null, explanation: null, nodeType
      };
      return {
        row: { ...base, ...columns, nodeId: reply.suggestion.faqId, kind: "answer", guard: guardOf(turn, opening.refused ?? closing.refused), blocks: excerpt ? excerpt.map((block) => block.id) : [], covered: null, texts },
        update: { unsolved: "reset", currentNodeId: reply.suggestion.faqId }
      };
    }
    if (turn?.kind === "smalltalk") {
      const line = screened("reply", turn.reply);
      const texts: AssistTexts = { opening: null, closing: null, reply: line.text ?? replyTemplate(variant, turn.intent), explanation: null, nodeType: null };
      return { row: { ...base, ...columns, nodeId: null, kind: "smalltalk", guard: guardOf(turn, line.refused), covered: null, texts, alternatives: [] }, update: { unsolved: "keep" } };
    }
    if (turn?.kind === "clarify" && session.currentNodeId) {
      // Only the card Portal knows is on screen can be explained; its own words ground the explanation.
      const nodeId = session.currentNodeId;
      const card = await shownCard(graph, nodeId, locale);
      const onScreen = turn.nodeId === nodeId && card !== null;
      const line = onScreen && turn.covered === true ? screened("explanation", turn.explanation, card.answer) : { text: null, refused: null };
      const covered = line.text !== null;
      const texts: AssistTexts = { opening: null, closing: null, reply: null, explanation: line.text, nodeType: null };
      const refused = line.refused ?? (onScreen ? null : "not_covered");
      return {
        row: { ...base, ...columns, faqId: nodeId, faqQuestion: card ? clip(card.question, 200) : null, answer: covered ? line.text : null, alternatives: [], nodeId, kind: "clarify", guard: guardOf(turn, refused), covered, texts },
        update: { unsolved: covered ? "reset" : "increment" }
      };
    }
    // No answer (no match, a clarify with no card on screen, Admin down or late): the v3 fallback and alternatives.
    return { row: { ...base, ...columns, nodeId: null, kind: "no_match", guard: null, covered: null, texts: null }, update: { unsolved: "increment" } };
  }

  /** The v5 turn of a row, built from the row alone (so a fresh answer and an Idempotency-Key replay are the same) and the cached release. */
  async function turnOf(row: AssistRecord): Promise<AssistantTurn | null> {
    if (!row.kind || row.kind === "handover" || !row.sessionId || !row.turnIndex || !row.via) return null;
    const graph = row.nodeId && (row.kind === "answer") ? await graphFor(row.locale) : null;
    const node: FaqNode | null = row.nodeId ? graph?.node(row.nodeId) ?? null : null;
    const texts = row.texts ?? null;
    const answered = row.kind === "answer" && row.answer !== null;
    const covered = row.kind === "clarify" ? row.covered === true : null;
    // Part D: only "the model said the card does not say it" may claim so; a timeout, an error or a refused explanation gets the neutral line
    const uncovered = row.kind === "clarify" && !covered ? (row.guard === "not_covered" ? "not_covered" as const : "unavailable" as const) : null;
    return {
      kind: row.kind, intent: row.intent ?? null, via: row.via, nodeId: row.nodeId ?? null, nodeType: row.kind === "answer" ? texts?.nodeType ?? node?.type ?? "answer" : null,
      opening: texts?.opening ?? null, closing: texts?.closing ?? null, reply: texts?.reply ?? null, explanation: texts?.explanation ?? null, covered, uncovered,
      excerpt: answered && node && node.answer === row.answer ? excerptOf(node, row.blocks ?? []) : null,
      next: answered ? nextOf(graph, node) : null,
      source: row.kind === "clarify" && row.faqId && row.faqQuestion ? { faqId: row.faqId, question: row.faqQuestion } : null,
      releaseVersion: row.releaseVersion ?? null, sessionId: row.sessionId, turnIndex: row.turnIndex,
      unsolved: row.kind === "no_match" || (row.kind === "clarify" && !covered) || (row.kind === "answer" && row.answer === null),
      countsAsQuestion: row.kind === "answer" || row.kind === "no_match"
    };
  }

  async function responseOf(row: AssistRecord): Promise<AssistantResponse | AssistantTurnResponse> {
    const base = replyOf(row);
    const turn = await turnOf(row).catch(() => null);
    return turn ? { ...base, turn } : base;
  }

  async function replay(key: string, hash: string): Promise<AssistantResponse | null> {
    const earlier = await repository.findAssistByKey(key);
    if (!earlier) return null;
    if (earlier.payloadHash !== hash) throw new HelpdeskProblem("idempotency_conflict", "This Idempotency-Key was already used for a different request.");
    return responseOf(earlier);
  }

  async function enforceRateLimit(learnerId: string) {
    const at = now();
    const oldest = await repository.nthRecentAssistAt(learnerId, new Date(at.getTime() - RATE_WINDOW_MS).toISOString(), HELPDESK_LIMITS.assistantPerHour, LIMITED_SOURCES);
    if (!oldest) return;
    const retryAfter = Math.max(1, Math.ceil((Date.parse(oldest) + RATE_WINDOW_MS - at.getTime()) / 1000));
    log({ type: "helpdesk", event: "rate_limited", limit: "assistant", retryAfter });
    throw new HelpdeskProblem("rate_limited", `You can ask at most ${HELPDESK_LIMITS.assistantPerHour} questions an hour. Try again later.`, { retryAfter });
  }

  /** One logical request per Idempotency-Key on this instance: a second one with the same key waits for the first and replays it. */
  async function once(key: string, hash: string, work: () => Promise<{ response: AssistantResponse; replayed: boolean }>): Promise<{ response: AssistantResponse; replayed: boolean }> {
    const running = askInFlight.get(key);
    if (running) {
      await running.catch(() => undefined);
      const stored = await replay(key, hash);
      if (stored) return { response: stored, replayed: true };
    }
    const started = (async () => {
      const earlier = await replay(key, hash);
      if (earlier) return { response: earlier, replayed: true };
      return work();
    })();
    askInFlight.set(key, started);
    try {
      return await started;
    } finally {
      if (askInFlight.get(key) === started) askInFlight.delete(key);
    }
  }

  /** Stores a session turn; a duplicate (the same key raced in) answers with what is stored. */
  async function storeTurn({ row, update }: TurnRow, key: string, hash: string): Promise<{ response: AssistantResponse; replayed: boolean }> {
    const result = await repository.recordTurn(row, update);
    if (result.status === "inserted") return { response: await responseOf({ ...row, turnIndex: result.turnIndex }), replayed: false };
    if (result.status === "duplicate") {
      const stored = await replay(key, hash);
      if (stored) return { response: stored, replayed: true };
      throw new HelpdeskProblem("idempotency_conflict", "This answer was already recorded.");
    }
    // The session vanished between reading and recording (it cannot, short of a manual delete): record the row alone.
    if ((await repository.insertAssist({ ...row, sessionId: null, turnIndex: null })) === "duplicate") throw new HelpdeskProblem("idempotency_conflict", "This answer was already recorded.");
    return { response: replyOf(row), replayed: false };
  }

  type AskInput = AssistantInput & { sessionId?: string | null; via?: ClickVia | null };

  /** POST /api/helpdesk/assistant: one chat question, or (with faqId) a chip asked through Admin's per-FAQ path. */
  async function ask(learner: LearnerIdentity, input: AskInput, key: string): Promise<{ response: AssistantResponse; replayed: boolean }> {
    const hash = hashOf({ op: "assistant", learnerId: learner.id, message: input.message, locale: input.locale, faqId: input.faqId, ...(input.sessionId ? { sessionId: input.sessionId } : {}), ...(input.via ? { via: input.via } : {}) });
    return once(key, hash, () => askOnce(learner, input, key, hash));
  }

  async function askOnce(learner: LearnerIdentity, input: AskInput, key: string, hash: string): Promise<{ response: AssistantResponse; replayed: boolean }> {
    await enforceRateLimit(learner.id);
    const source: AssistSource = input.faqId ? "chip" : "chat";
    const session = await sessionFor(learner, input.locale, input.sessionId ?? null);
    const run = await runIds(learner.id);
    // v5 Part D: the card on screen, the session, and what the learner typed earlier in it (Portal's own log; never account data).
    // v7: and the learner state (typed questions only: a chip takes Admin's per-FAQ path, no model)
    const [recentTurns, state] = input.faqId ? [[], null] : await Promise.all([repository.sessionLearnerTurns(session.id, HELPDESK_LIMITS.recentTurnsMax).catch(() => [] as string[]), stateOf(learner)]);
    const context = buildSuggestContext({ nodeId: session.currentNodeId, sessionId: session.id, recentTurns, learnerState: state });
    const request: AdminSuggestRequest = { learnerId: learner.id, locale: input.locale, source, message: input.message, ...(input.faqId ? { faqId: input.faqId } : {}), ...run, context };
    const reply = await askAdmin(request);
    const base = record(run.runId, learner, source, input.locale, input.message, reply, now(), key, hash);
    if (!input.faqId) return storeTurn(await typedRow(base, reply, session, input.locale), key, hash);
    // A chip through Admin's per-FAQ path: no model, so the fixed click templates frame the card. When the release
    // is cached, its node type decides: a choice has no frame (as for a click); otherwise the card is an answer.
    const graph = reply.suggestion ? await graphFor(input.locale) : null;
    const nodeType = (reply.suggestion && graph?.node(reply.suggestion.faqId)?.type) || "answer";
    const framed = nodeType === "answer";
    const frame = TURN_TEMPLATES[frameVariant(input.locale, await learnerWords(session.id))];
    const texts: AssistTexts | null = reply.suggestion ? { opening: framed ? frame.opening : null, closing: framed ? frame.closing : null, reply: null, explanation: null, nodeType } : null;
    const row: AssistRecord = {
      ...base, sessionId: session.id, nodeId: reply.suggestion?.faqId ?? null, parentNodeId: session.currentNodeId, via: input.via ?? "starter", kind: reply.suggestion ? "answer" : "no_match",
      intent: null, guard: null, releaseVersion: null, traceId: deps.traceId ?? null, signals: session.signals, blocks: [], expanded: null, covered: null, texts
    };
    return storeTurn({ row, update: reply.suggestion ? { unsolved: "reset", currentNodeId: reply.suggestion.faqId } : { unsolved: "increment" } }, key, hash);
  }

  /**
   * POST /api/helpdesk/assistant/click (graph design §4): a chip, follow-up or option. Code only: the node must be in
   * the cached release, a follow-up or option must be an edge of that kind from the card it was clicked on, and a
   * chip must open an entry node; anything else is 400. The node is shown verbatim with the fixed templates; neither
   * the model nor Admin is asked. Before Admin has a release, a chip goes through Admin's per-FAQ path (as before v5).
   */
  async function click(learner: LearnerIdentity, input: AssistantClickInput, key: string): Promise<{ response: AssistantResponse; replayed: boolean }> {
    const hash = hashOf({ op: "assistant_click", learnerId: learner.id, ...input });
    return once(key, hash, async () => {
      await enforceRateLimit(learner.id);
      const graph = await graphFor(input.locale);
      const step = input.via === "follow_up" || input.via === "option";
      if (!graph) {
        if (step) throw new HelpdeskProblem("invalid_request", "That step is not available in this chat.");
        if (!input.label) throw new HelpdeskProblem("validation_failed", "label is required.", {}, "label");
        return askOnce(learner, { message: input.label, locale: input.locale, faqId: input.nodeId, sessionId: input.sessionId, via: input.via }, key, hash);
      }
      const node = graph.node(input.nodeId);
      const edge = step && input.fromNodeId ? graph.edge(input.fromNodeId, input.nodeId) : null;
      const refuse = () => {
        log({ type: "helpdesk", event: "assistant_click_refused", via: input.via, release: graph.release.version });
        return new HelpdeskProblem("invalid_request", "That step is not available in this chat.");
      };
      if (!node || (step ? !edge || edge.kind !== input.via : !node.entry)) throw refuse();
      const session = await sessionFor(learner, input.locale, input.sessionId);
      // A step is clicked on a card this chat showed (the session named, or the one it rolled over to): a non-entry
      // follow-up cannot be opened on its own by naming any parent.
      if (step && input.fromNodeId) {
        const sessions = [...new Set([session.id, ...(input.sessionId ? [input.sessionId] : [])])];
        const shown = session.currentNodeId === input.fromNodeId || await repository.sessionShowedNode(sessions, learner.id, input.fromNodeId);
        if (!shown) throw refuse();
      }
      const frame = TURN_TEMPLATES[frameVariant(input.locale, await learnerWords(session.id))];
      const at = now();
      const texts: AssistTexts = { opening: node.type === "answer" ? frame.opening : null, closing: node.type === "answer" ? frame.closing : null, reply: null, explanation: null, nodeType: node.type };
      const row: AssistRecord = {
        id: uuidv7(at.getTime()), learnerId: learner.id, source: "chip", locale: input.locale, question: clip(edge?.label ?? node.question, HELPDESK_LIMITS.assistQuestionMax),
        faqId: node.id, faqQuestion: clip(node.question, 200), answer: clip(node.answer, 4000), feedback: null, ticketId: null, clientEventId: key, payloadHash: hash,
        createdAt: at.toISOString(), feedbackDeliveredAt: null, feedbackAttemptedAt: null, alternatives: [],
        sessionId: session.id, nodeId: node.id, parentNodeId: input.fromNodeId ?? session.currentNodeId, via: input.via, kind: "answer", intent: null, guard: null,
        releaseVersion: graph.release.version, traceId: deps.traceId ?? null, signals: session.signals, blocks: [], expanded: null, covered: null, texts
      };
      return storeTurn({ row, update: { unsolved: "reset", currentNodeId: node.id } }, key, hash);
    });
  }

  /**
   * POST /api/helpdesk/assistant/sessions (Part A): a new chat session and its chips, when the panel loads and after an
   * idle end. Signals come from the learner's own records (and from_order only for their own order); the chips from the
   * release's entry nodes, or the published FAQs before there is a release. Nothing here asks the model.
   */
  async function startSession(learner: LearnerIdentity, input: AssistantSessionInput): Promise<AssistantSessionResponse> {
    const fromOrder = input.orderId && deps.ownsOrder ? await deps.ownsOrder(learner.id, input.orderId).catch(() => false) : false;
    const [signals, graph] = await Promise.all([signalsOf(learner, fromOrder), graphFor(input.locale)]);
    const candidates: ChipCandidate[] = graph
      ? graph.release.nodes.filter((node) => node.entry)
      : ((deps.admin.faqs ? await deps.admin.faqs(input.locale).catch(() => null) : null) ?? []);
    const chosen = chooseSituationChips(signals, candidates);
    const waitingTicket = signals.includes("open_ticket_waiting") ? waitingTicketOf(await repository.listTicketsByUser(learner.id).catch(() => [])) : null;
    const releaseVersion = graph?.release.version ?? null;
    // The panel starts a session on every load: while the learner's last one is still unused (open, no turns, not
    // idle, same locale, release and signals), it is handed out again, so repeated calls add no rows.
    const since = new Date(now().getTime() - CHAT_SESSION_RULES.idleMs + 1).toISOString();
    const unused = await repository.openEmptyChatSession(learner.id, input.locale, since).catch(() => null);
    const reused = unused !== null && unused.releaseVersion === releaseVersion && sameSignals(unused.signals, signals);
    const session = reused ? unused : await newSession(learner, input.locale, signals, releaseVersion);
    // Enum names only: which signals were on and which produced chips.
    log({ type: "helpdesk", event: "assistant_session_started", signals, chipSignals: chosen.matched, release: session.releaseVersion, reused });
    return { sessionId: session.id, chips: chosen.chips, situational: chosen.situational, waitingTicket, releaseVersion: session.releaseVersion };
  }

  function sameSignals(a: readonly SituationSignal[], b: readonly SituationSignal[]): boolean {
    return a.length === b.length && a.every((signal) => b.includes(signal));
  }

  /** POST /api/helpdesk/assistant/sessions/{id}/end: the first end wins (the chat's End chat, its idle end, or a handover). */
  async function endSession(learner: LearnerIdentity, id: string, reason: LearnerEndReason): Promise<{ sessionId: string; endedAt: string; endReason: string }> {
    const session = await repository.endChatSession(id, learner.id, reason, now().toISOString());
    if (!session || !session.endedAt || !session.endReason) throw new HelpdeskProblem("not_found", "No such chat session.");
    return { sessionId: session.id, endedAt: session.endedAt, endReason: session.endReason };
  }

  /** POST /api/helpdesk/assistant/{id}/expanded (Part H): the learner opened the full answer of an excerpt (logged once). */
  async function expand(learner: LearnerIdentity, id: string): Promise<{ id: string; expanded: true }> {
    // Only the learner's own answer card: a choice card, small talk or an explanation has nothing to expand.
    const found = await repository.findAssist(id);
    if (!found || found.learnerId !== learner.id || found.answer === null || found.kind !== "answer" || found.texts?.nodeType === "choice") throw new HelpdeskProblem("not_found", "No such answer.");
    const row = await repository.setAssistExpanded(id, learner.id);
    if (!row) throw new HelpdeskProblem("not_found", "No such answer.");
    return { id: row.id, expanded: true };
  }

  /** Tells Admin the stored feedback unless it already confirmed it; true when Admin has it. */
  async function deliver(row: AssistRecord): Promise<boolean> {
    if (row.feedback === null) return false;
    if (row.feedbackDeliveredAt) return true;
    // v5: a click answered from the release was never Admin's run; its feedback stays in Portal.
    if (answeredByPortal(row)) return false;
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
    return { suggestion: reply.suggestion, alternatives: reply.alternatives };
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

  return { ask, click, startSession, endSession, expand, feedback, checkForSubmit, suggestForSubmit, submitOutcome, rate, deliverOutcome, deliverPending };
}

export type AssistantService = ReturnType<typeof createAssistantService>;
