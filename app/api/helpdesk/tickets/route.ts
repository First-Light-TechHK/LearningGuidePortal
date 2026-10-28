import { parseCreateTicketInput } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readMultipart, requireLearner } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/helpdesk/tickets → { tickets: TicketSummary[] } (own tickets, newest activity first). */
export async function GET(request: Request) {
  try {
    const learner = await requireLearner(request);
    return jsonResponse(await helpdeskService().listLearnerTickets(learner));
  } catch (error) { return problemResponse(error, "learner.list"); }
}

/** POST /api/helpdesk/tickets (multipart: category, subject, body, locale, files[]; Idempotency-Key) → 201 TicketDetail. */
export async function POST(request: Request) {
  try {
    const learner = await requireLearner(request, { write: true });
    const key = idempotencyKey(request);
    const { fields, files } = await readMultipart(request);
    const result = await helpdeskService().createTicket(learner, parseCreateTicketInput(fields, files), key);
    return jsonResponse(result.ticket, 201, result.replayed);
  } catch (error) { return problemResponse(error, "learner.create"); }
}
