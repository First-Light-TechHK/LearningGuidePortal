import { parseAssistantFeedback } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/assistant/{id}/feedback ({ helpful: boolean }; Idempotency-Key) → 200 { id, feedback }.
 * "Helpful?" on one of the learner's own answers. The first value wins (a
 * repeat answers with the stored value) and is forwarded to Admin as
 * helpful / not_helpful.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request, { write: true });
    const id = await ticketIdParam(context);
    idempotencyKey(request);
    const helpful = parseAssistantFeedback(await readJsonBody(request));
    return jsonResponse(await helpdeskAssistant(request).feedback(learner, id, helpful));
  } catch (error) { return problemResponse(error, "learner.assistant_feedback"); }
}
