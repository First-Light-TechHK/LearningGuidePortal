import { jsonResponse, problemResponse, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/helpdesk/tickets/{id} → TicketDetail (own ticket only; internal notes never included). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request);
    return jsonResponse(await helpdeskService().getLearnerTicket(learner, await ticketIdParam(context)));
  } catch (error) { return problemResponse(error, "learner.detail"); }
}
