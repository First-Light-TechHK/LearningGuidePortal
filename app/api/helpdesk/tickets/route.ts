import { parseCreateTicketInput } from "@/contracts/helpdesk";
import { adminHostResponse, idempotencyKey, jsonResponse, problemResponse, readMultipart, requireLearner } from "@/modules/helpdesk/http";
import { helpdeskAssistant, helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/helpdesk/tickets → { tickets: TicketSummary[] } (own tickets, newest activity first). */
export async function GET(request: Request) {
  const blocked = adminHostResponse(request);
  if (blocked) return blocked;
  try {
    const learner = await requireLearner(request);
    return jsonResponse(await helpdeskService().listLearnerTickets(learner));
  } catch (error) { return problemResponse(error, "learner.list"); }
}

/** POST /api/helpdesk/tickets (multipart: category, subject, body, locale, files[]; Idempotency-Key) → 201 TicketDetail. */
export async function POST(request: Request) {
  const blocked = adminHostResponse(request);
  if (blocked) return blocked;
  try {
    const learner = await requireLearner(request, { write: true });
    const key = idempotencyKey(request);
    const { fields, files } = await readMultipart(request);
    const input = parseCreateTicketInput(fields, files);
    const result = await helpdeskService().createTicket(learner, input, key);
    // The ticket's transaction recorded "declined" for the submit-time suggestion; tell Admin from
    // the server (in the background: Admin being slow never delays the learner; the sweep retries).
    if (input.suggestionId && !result.replayed) {
      void helpdeskAssistant().deliverOutcome(input.suggestionId).catch((error: unknown) => {
        console.info(JSON.stringify({ type: "helpdesk", event: "assistant_outcome_not_delivered", error: error instanceof Error ? error.name : "unknown" }));
      });
    }
    return jsonResponse(result.ticket, 201, result.replayed);
  } catch (error) { return problemResponse(error, "learner.create"); }
}
