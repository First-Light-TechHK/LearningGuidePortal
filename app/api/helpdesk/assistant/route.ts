import { parseAssistantTurnInput } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireLearner } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/assistant ({ message, locale, faqId? }; Idempotency-Key) → 200 { id, reply: { id, faqId, question, answer } | null, alternatives: { faqId, question }[] }.
 * One AI Support Assistant question (v2 §4b): a chip sends its FAQ id. Admin
 * picks a stored answer, shown verbatim; reply null (no match, Admin down,
 * the 4 s timeout) means the page shows its fallback, then (v3) Admin's
 * alternatives as chips, [] with an answer. 30 per learner per
 * hour, then 429 rate_limited with Retry-After. id is the logged answer the
 * learner's next enquiry can link (assistIds).
 * v5 (additive): sessionId (from POST /api/helpdesk/assistant/sessions; a
 * missing, ended or idle one starts a new session) and, with faqId, via (the
 * chip's reason). The answer adds turn: kind answer / smalltalk / clarify /
 * no_match, the guarded short strings, the excerpt and next steps from the
 * cached release, and the session it was recorded in (contracts AssistantTurn).
 */
export async function POST(request: Request) {
  try {
    const learner = await requireLearner(request, { write: true });
    const key = idempotencyKey(request);
    const input = parseAssistantTurnInput(await readJsonBody(request));
    const result = await helpdeskAssistant(request).ask(learner, input, key);
    return jsonResponse(result.response, 200, result.replayed);
  } catch (error) { return problemResponse(error, "learner.assistant"); }
}
