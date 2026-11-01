// Helpdesk v5 Part G1/G2 (helpdesk-v5-context-chips-and-smalltalk.md;
// helpdesk-v5-faq-graph-design.md §3, §5.5): the flywheel feed Admin's
// nightly gap mining reads (GET /api/integration/helpdesk/insights).
// - Learner text leaves Portal only here and only after the code-only
//   scrubber, with the learner's own account name and email and the names
//   and emails on their enquiries removed too.
// - Everything else is a label: enum names, node ids, the release version,
//   the vote and rating, the session's place, and the enquiry outcome read
//   from the tickets (helpdesk_assist_outcomes). No learner id, name, email,
//   order, plan, ticket id, number or subject, and no answer text (Admin owns
//   its FAQs), short line or trace id.
// - The agent's last public reply goes along (scrubbed) only when the agent
//   resolved the enquiry: a human answer is the only draft source for a new
//   FAQ (Admin marks it 草稿 待核实; the model never writes FAQ facts).
// - Read-only and paged by (createdAt, id); the window's end (until) is fixed
//   by the first page and carried in the cursor, and never later than a
//   minute ago, so a cursor always returns the same turns.
import {
  ASSIST_FEEDBACK, ASSIST_VIAS, CHAT_END_REASONS, INSIGHT_LIMITS, SITUATION_SIGNALS, SUGGEST_INTENTS, TURN_GUARDS, TURN_KINDS,
  encodeInsightsCursor, type InsightTurn, type InsightsPage, type InsightsQuery
} from "@/contracts/helpdesk";
import { scrubPii, type ScrubContext } from "./piiScrubber";
import type { HelpdeskRepository, InsightRow, LearnerContacts } from "./repository";

/** The learner's account name and email (Portal's product store), only to scrub them; never sent. */
export type LearnerAccount = { name: string; email: string | null };
export type AccountDirectory = (learnerIds: string[]) => Promise<Map<string, LearnerAccount>>;

function clip(text: string, max: number) {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join("");
}

const known = <T extends string>(values: readonly T[], value: unknown): T | null => ((values as readonly unknown[]).includes(value) ? value as T : null);

/** Who and what the scrubber removes for this learner: their account and their enquiries' names and emails. */
export function scrubContextOf(account: LearnerAccount | undefined, contacts: LearnerContacts): ScrubContext {
  return { names: [account?.name ?? "", ...contacts.names].filter(Boolean), emails: [account?.email ?? "", ...contacts.emails].filter(Boolean) };
}

/** One row as the feed sends it (pure). */
export function insightTurn(row: InsightRow, account: LearnerAccount | undefined): InsightTurn {
  const context = scrubContextOf(account, row.contacts);
  const lastTurn = row.sessionId && row.turnIndex !== null && row.turnIndex !== undefined && row.sessionTurns !== null ? row.turnIndex === row.sessionTurns : null;
  const endReason = known(CHAT_END_REASONS, row.sessionEndReason);
  const kind = known(TURN_KINDS, row.kind);
  const outcome = row.outcome;
  return {
    id: row.id, createdAt: row.createdAt, source: row.source, locale: row.locale, text: clip(scrubPii(row.question, context), INSIGHT_LIMITS.textMax),
    sessionId: row.sessionId ?? null, turnIndex: row.turnIndex ?? null, lastTurn, sessionEndReason: endReason,
    kind, intent: known(SUGGEST_INTENTS, row.intent), guard: known(TURN_GUARDS, row.guard), via: known(ASSIST_VIAS, row.via),
    faqId: row.faqId, nodeId: row.nodeId ?? null, parentNodeId: row.parentNodeId ?? null, releaseVersion: row.releaseVersion ?? null,
    answered: row.answer !== null, vote: known(ASSIST_FEEDBACK, row.feedback), rating: row.rating, covered: row.covered ?? null, expanded: row.expanded ?? null,
    // Handed to a person after this turn: Portal's own handover turn, or the session's last turn when it ended with a handover or an enquiry.
    handover: kind === "handover" || (lastTurn === true && (endReason === "handover" || endReason === "ticket")),
    ticketAfterChat: outcome !== null,
    ticket: outcome ? {
      linked: outcome.linked, status: outcome.status, closeReason: outcome.closeReason, resolvedByAgent: outcome.resolvedByAgent, agentReplied: outcome.agentReplyId !== null,
      agentReply: outcome.resolvedByAgent && outcome.agentReply ? clip(scrubPii(outcome.agentReply, context), INSIGHT_LIMITS.agentReplyMax) : null
    } : null,
    signals: (row.signals ?? []).filter((signal) => (SITUATION_SIGNALS as readonly string[]).includes(signal))
  };
}

export function createInsightsService(deps: { repository: Pick<HelpdeskRepository, "listInsightRows">; accounts: AccountDirectory; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function page(query: InsightsQuery): Promise<InsightsPage> {
    const settled = new Date(now().getTime() - INSIGHT_LIMITS.settleMs).toISOString();
    const requested = query.cursor?.until ?? query.until ?? settled;
    const until = requested < settled ? requested : settled;
    if (query.since >= until) return { turns: [], nextCursor: null, until };
    const rows = await deps.repository.listInsightRows({ sinceIso: query.since, untilIso: until, after: query.cursor ? { createdAt: query.cursor.createdAt, id: query.cursor.id } : null, limit: query.limit + 1 });
    const shown = rows.slice(0, query.limit);
    const accounts = shown.length ? await deps.accounts([...new Set(shown.map((row) => row.learnerId))]) : new Map<string, LearnerAccount>();
    const last = shown[shown.length - 1];
    return {
      turns: shown.map((row) => insightTurn(row, accounts.get(row.learnerId))),
      nextCursor: rows.length > query.limit && last ? encodeInsightsCursor({ createdAt: last.createdAt, id: last.id, until }) : null,
      until
    };
  }

  return { page };
}

export type InsightsService = ReturnType<typeof createInsightsService>;
