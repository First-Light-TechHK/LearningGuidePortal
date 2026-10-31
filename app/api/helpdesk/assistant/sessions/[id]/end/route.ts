import { parseChatEndReason } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, readJsonBody, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/assistant/sessions/{id}/end ({ reason: idle | ended_by_learner | handover }) → 200 { sessionId, endedAt, endReason }
 * (Helpdesk v5, graph design §3). The chat's End chat, its idle end or a handover; the first end wins (a repeat
 * answers with the stored end). An enquiry that links the chat ends it as ticket. 404 for another learner's session.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request, { write: true });
    const id = await ticketIdParam(context);
    const reason = parseChatEndReason(await readJsonBody(request));
    return jsonResponse(await helpdeskAssistant(request).endSession(learner, id, reason));
  } catch (error) { return problemResponse(error, "learner.assistant_session_end"); }
}
