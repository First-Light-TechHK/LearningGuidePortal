import { parseAssistantTurnInput } from "@/contracts/helpdesk";
import { eventStreamResponse, idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireLearner, wantsEventStream } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/assistant ({ message, locale, faqId? }; Idempotency-Key) → 200 { id, reply: { id, faqId, question, answer } | null, alternatives: { faqId, question }[] }.
 * One AI Support Assistant question (v2 §4b): a chip sends its FAQ id. Admin
 * picks a stored answer, shown verbatim; reply null (no match, Admin down,
 * the 16 s wait while Admin thinks) means the page shows its fallback, then (v3) Admin's
 * alternatives as chips, [] with an answer. 30 per learner per
 * hour, then 429 rate_limited with Retry-After. id is the logged answer the
 * learner's next enquiry can link (assistIds).
 * v5 (additive): sessionId (from POST /api/helpdesk/assistant/sessions; a
 * missing, ended or idle one starts a new session) and, with faqId, via (the
 * chip's reason). The answer adds turn: kind answer / smalltalk / clarify /
 * no_match, the guarded short strings, the excerpt and next steps from the
 * cached release, and the session it was recorded in (contracts AssistantTurn).
 * v7 (additive): with Accept: text/event-stream the answer streams: event step { step } as each step of Admin's
 * workflow starts (the chat's "thinking" card; only the step name), then event result (the same JSON body) or event
 * error (the problem body, status inside). Sign-in, the Idempotency-Key and the body are checked before the stream
 * starts, so those failures keep their HTTP status.
 */
export async function POST(request: Request) {
  try {
    const learner = await requireLearner(request, { write: true });
    const key = idempotencyKey(request);
    const input = parseAssistantTurnInput(await readJsonBody(request));
    const assistant = helpdeskAssistant(request);
    if (wantsEventStream(request)) {
      return eventStreamResponse(async (send) => (await assistant.ask(learner, input, key, { onStep: (step) => send("step", { step }) })).response, "learner.assistant");
    }
    const result = await assistant.ask(learner, input, key);
    return jsonResponse(result.response, 200, result.replayed);
  } catch (error) { return problemResponse(error, "learner.assistant"); }
}
