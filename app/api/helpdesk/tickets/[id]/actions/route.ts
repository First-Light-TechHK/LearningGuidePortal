import { parseLearnerActionInput } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/helpdesk/tickets/{id}/actions ({ action, expectedSequence, rating?, message? }; Idempotency-Key) → 200 TicketDetail. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request, { write: true });
    const ticketId = await ticketIdParam(context);
    const key = idempotencyKey(request);
    const input = parseLearnerActionInput(await readJsonBody(request));
    const result = await helpdeskService().learnerAction(learner, ticketId, input, key);
    return jsonResponse(result.ticket, 200, result.replayed);
  } catch (error) { return problemResponse(error, "learner.action"); }
}
