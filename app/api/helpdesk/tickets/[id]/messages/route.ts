import { parseLearnerMessageInput } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readMultipart, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/helpdesk/tickets/{id}/messages (multipart: body, expectedSequence, files[]; Idempotency-Key) → 201 TicketDetail. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request, { write: true });
    const ticketId = await ticketIdParam(context);
    const key = idempotencyKey(request);
    const { fields, files } = await readMultipart(request);
    const result = await helpdeskService().learnerMessage(learner, ticketId, parseLearnerMessageInput(fields, files), key);
    return jsonResponse(result.ticket, 201, result.replayed);
  } catch (error) { return problemResponse(error, "learner.message"); }
}
