import { parseAssistantSessionInput } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, readJsonBody, requireLearner } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/assistant/sessions ({ locale, orderId? }) → 201 { sessionId, chips, situational, waitingTicket, releaseVersion }
 * (Helpdesk v5 Part A). A new chat session, started when the chat panel loads and again after an idle end, with
 * up to 4 situation chips chosen by code from the learner's own records (signals by priority, then popular FAQs).
 * orderId (Contact Support opened from an order) counts only when it is the learner's own. The chips are FAQ
 * questions as staff wrote them (no amounts, order numbers or dates); the signals themselves are not returned and
 * never reach Admin or the model.
 */
export async function POST(request: Request) {
  try {
    const learner = await requireLearner(request, { write: true });
    const input = parseAssistantSessionInput(await readJsonBody(request));
    return jsonResponse(await helpdeskAssistant(request).startSession(learner, input), 201);
  } catch (error) { return problemResponse(error, "learner.assistant_session"); }
}
